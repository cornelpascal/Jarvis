using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Threading.Channels;
using Jarvis.Protocol;
using Windows.Media;
using Windows.Media.Audio;
using Windows.Media.Capture;
using Windows.Media.MediaProperties;
using WinRT;
using ProtocolAudioFrame = Jarvis.Protocol.AudioFrame;

namespace Jarvis.Infrastructure;

[ComImport]
[Guid("5B0D3235-4DBA-4D44-865E-8F1D0E4FD04D")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal unsafe interface IMemoryBufferByteAccess
{
    void GetBuffer(out byte* buffer, out uint capacity);
}

public sealed class WindowsAudioCaptureService : IAudioCaptureService
{
    public const int CaptureSampleRate = 24_000;
    public const int CaptureSamplesPerQuantum = 1_920;
    private readonly ConcurrentDictionary<Guid, Channel<ProtocolAudioFrame>> _subscribers = new();
    private AudioGraph? _graph;
    private AudioDeviceInputNode? _input;
    private AudioFrameOutputNode? _output;
    private bool _frameBufferIsFloat;

    public bool IsRunning { get; private set; }

    public async Task StartAsync(CancellationToken cancellationToken = default)
    {
        if (IsRunning) return;
        var encoding = AudioEncodingProperties.CreatePcm(CaptureSampleRate, 1, 16);
        var graphResult = await AudioGraph.CreateAsync(new AudioGraphSettings(Windows.Media.Render.AudioRenderCategory.Speech)
        {
            EncodingProperties = encoding,
            QuantumSizeSelectionMode = QuantumSizeSelectionMode.ClosestToDesired,
            DesiredSamplesPerQuantum = CaptureSamplesPerQuantum,
        });
        if (graphResult.Status != AudioGraphCreationStatus.Success)
        {
            graphResult = await AudioGraph.CreateAsync(new AudioGraphSettings(Windows.Media.Render.AudioRenderCategory.Media)
            {
                QuantumSizeSelectionMode = QuantumSizeSelectionMode.ClosestToDesired,
            });
        }
        if (graphResult.Status != AudioGraphCreationStatus.Success)
        {
            throw new InvalidOperationException($"AudioGraph creation failed: {graphResult.Status}. Verify that Windows exposes an active microphone endpoint.");
        }
        _graph = graphResult.Graph;
        var inputResult = await _graph.CreateDeviceInputNodeAsync(MediaCategory.Speech);
        if (inputResult.Status != AudioDeviceNodeCreationStatus.Success)
        {
            _graph.Dispose();
            _graph = null;
            throw new InvalidOperationException($"Microphone creation failed: {inputResult.Status}");
        }
        _input = inputResult.DeviceInputNode;
        _output = _graph.CreateFrameOutputNode(encoding);
        _frameBufferIsFloat = _graph.EncodingProperties.Subtype.Equals("Float", StringComparison.OrdinalIgnoreCase);
        JarvisLog.Write("info", "voice.capture.format",
            $"graph={_graph.EncodingProperties.Subtype}/{_graph.EncodingProperties.SampleRate}Hz/{_graph.EncodingProperties.ChannelCount}ch/{_graph.EncodingProperties.BitsPerSample}bit; " +
            $"input={_input.EncodingProperties.Subtype}/{_input.EncodingProperties.SampleRate}Hz/{_input.EncodingProperties.ChannelCount}ch/{_input.EncodingProperties.BitsPerSample}bit; " +
            $"output={_output.EncodingProperties.Subtype}/{_output.EncodingProperties.SampleRate}Hz/{_output.EncodingProperties.ChannelCount}ch/{_output.EncodingProperties.BitsPerSample}bit");
        _input.AddOutgoingConnection(_output);
        _graph.QuantumStarted += GraphQuantumStarted;
        _graph.Start();
        IsRunning = true;
    }

    public Task StopAsync(CancellationToken cancellationToken = default)
    {
        if (!IsRunning) return Task.CompletedTask;
        IsRunning = false;
        if (_graph is not null)
        {
            _graph.QuantumStarted -= GraphQuantumStarted;
            _graph.Stop();
        }
        _input?.Dispose();
        _output?.Dispose();
        _graph?.Dispose();
        _input = null;
        _output = null;
        _graph = null;
        return Task.CompletedTask;
    }

    public async IAsyncEnumerable<ProtocolAudioFrame> Frames([EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var id = Guid.NewGuid();
        var channel = Channel.CreateBounded<ProtocolAudioFrame>(new BoundedChannelOptions(32)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
            SingleWriter = true,
        });
        _subscribers[id] = channel;
        try
        {
            await foreach (var frame in channel.Reader.ReadAllAsync(cancellationToken)) yield return frame;
        }
        finally
        {
            _subscribers.TryRemove(id, out _);
        }
    }

    private unsafe void GraphQuantumStarted(AudioGraph sender, object args)
    {
        var frame = _output?.GetFrame();
        if (frame is null) return;
        using (frame)
        {
            var bytes = CopyFrameBytes(frame);
            if (_frameBufferIsFloat) bytes = ConvertFloat32ToPcm16(bytes);
            if (bytes.Length == 0) return;
            var samples = MemoryMarshal.Cast<byte, short>(bytes);
            double energy = 0;
            foreach (var sample in samples)
            {
                var normalized = sample / 32768d;
                energy += normalized * normalized;
            }
            var rms = samples.Length == 0 ? 0f : (float)Math.Sqrt(energy / samples.Length);
            var value = new ProtocolAudioFrame(bytes, CaptureSampleRate, 1, rms, DateTimeOffset.UtcNow);
            foreach (var subscriber in _subscribers.Values) subscriber.Writer.TryWrite(value);
        }
    }

    internal static unsafe byte[] CopyFrameBytes(Windows.Media.AudioFrame frame)
    {
        using var buffer = frame.LockBuffer(AudioBufferAccessMode.Read);
        using var reference = buffer.CreateReference();
        var byteAccess = reference.As<IMemoryBufferByteAccess>();
        byteAccess.GetBuffer(out var data, out var capacity);
        var byteLength = checked((int)Math.Min(capacity, buffer.Length));
        byteLength -= byteLength % sizeof(short);
        if (data is null || byteLength == 0) return [];
        var bytes = new byte[byteLength];
        new ReadOnlySpan<byte>(data, byteLength).CopyTo(bytes);
        return bytes;
    }

    internal static byte[] ConvertFloat32ToPcm16(ReadOnlySpan<byte> source)
    {
        var floatLength = source.Length - source.Length % sizeof(float);
        if (floatLength == 0) return [];
        var input = MemoryMarshal.Cast<byte, float>(source[..floatLength]);
        var output = new byte[input.Length * sizeof(short)];
        var samples = MemoryMarshal.Cast<byte, short>(output.AsSpan());
        for (var index = 0; index < input.Length; index++)
        {
            var value = float.IsFinite(input[index]) ? Math.Clamp(input[index], -1f, 1f) : 0f;
            samples[index] = value <= -1f
                ? short.MinValue
                : (short)Math.Round(value * short.MaxValue);
        }
        return output;
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync();
        foreach (var subscriber in _subscribers.Values) subscriber.Writer.TryComplete();
        _subscribers.Clear();
    }
}
