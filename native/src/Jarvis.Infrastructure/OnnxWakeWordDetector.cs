using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Threading.Channels;
using Jarvis.Protocol;
using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;

namespace Jarvis.Infrastructure;

/// <summary>Native C# port of openWakeWord's streaming ONNX feature pipeline.</summary>
public sealed class OnnxWakeWordDetector : IWakeWordDetector
{
    private const int CadenceSamples = 1_280;
    private const int MelContextSamples = CadenceSamples + 480;
    private const int MelFrames = 76;
    private const int MelBins = 32;
    private const int ClassifierFrames = 16;
    private const int EmbeddingWidth = 96;
    private readonly InferenceSession _melSession;
    private readonly InferenceSession _embeddingSession;
    private readonly InferenceSession _classifierSession;
    private readonly float _threshold;
    private readonly TimeSpan _cooldown;
    private readonly Channel<WakeWordDetection> _detections = Channel.CreateBounded<WakeWordDetection>(8);
    private readonly CancellationTokenSource _lifetime = new();
    private readonly Queue<short> _pendingSamples = new();
    private readonly Queue<short> _rawHistory = new();
    private readonly Queue<float[]> _melHistory = new();
    private readonly Queue<float[]> _featureHistory = new();
    private Task? _pump;
    private long _lastDetectionTicks;
    private volatile bool _suppressed;

    public OnnxWakeWordDetector(string modelDirectory, float threshold = 0.5f, int cooldownMilliseconds = 5_000)
    {
        var melPath = Path.Combine(modelDirectory, "melspectrogram.onnx");
        var embeddingPath = Path.Combine(modelDirectory, "embedding_model.onnx");
        var classifierPath = Path.Combine(modelDirectory, "hey_jarvis_v0.1.onnx");
        foreach (var path in new[] { melPath, embeddingPath, classifierPath })
        {
            if (!File.Exists(path)) throw new FileNotFoundException("The native openWakeWord ONNX bundle is incomplete.", path);
        }
        _melSession = CreateSession(melPath);
        _embeddingSession = CreateSession(embeddingPath);
        _classifierSession = CreateSession(classifierPath);
        _threshold = threshold;
        _cooldown = TimeSpan.FromMilliseconds(cooldownMilliseconds);
        for (var index = 0; index < MelFrames; index++) _melHistory.Enqueue(Enumerable.Repeat(1f, MelBins).ToArray());
        for (var index = 0; index < ClassifierFrames; index++) _featureHistory.Enqueue(new float[EmbeddingWidth]);
    }

    private static InferenceSession CreateSession(string path) => new(path, new SessionOptions
    {
        GraphOptimizationLevel = GraphOptimizationLevel.ORT_ENABLE_ALL,
        InterOpNumThreads = 1,
        IntraOpNumThreads = 1,
    });

    public Task StartAsync(IAsyncEnumerable<AudioFrame> frames, CancellationToken cancellationToken = default)
    {
        if (_pump is not null) return Task.CompletedTask;
        var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, _lifetime.Token);
        _pump = PumpAsync(frames, linked.Token);
        return Task.CompletedTask;
    }

    private async Task PumpAsync(IAsyncEnumerable<AudioFrame> frames, CancellationToken cancellationToken)
    {
        await foreach (var frame in frames.WithCancellation(cancellationToken))
        {
            if (frame.Channels != 1 || frame.SampleRate <= 0) continue;
            var input = MemoryMarshal.Cast<byte, short>(frame.Pcm16.Span);
            var samples = frame.SampleRate == 16_000
                ? input.ToArray()
                : ResampleTo16Khz(input, frame.SampleRate);
            foreach (var sample in samples) _pendingSamples.Enqueue(sample);
            while (_pendingSamples.Count >= CadenceSamples)
            {
                for (var index = 0; index < CadenceSamples; index++)
                {
                    _rawHistory.Enqueue(_pendingSamples.Dequeue());
                    while (_rawHistory.Count > 160_000) _rawHistory.Dequeue();
                }
                var score = PredictCadence();
                if (_suppressed) continue;
                var now = DateTimeOffset.UtcNow;
                var lastTicks = Interlocked.Read(ref _lastDetectionTicks);
                if (score >= _threshold && (lastTicks == 0 || now - new DateTimeOffset(lastTicks, TimeSpan.Zero) >= _cooldown))
                {
                    Interlocked.Exchange(ref _lastDetectionTicks, now.UtcTicks);
                    _detections.Writer.TryWrite(new WakeWordDetection("hey jarvis", score, now));
                }
            }
        }
    }

    internal static short[] ResampleTo16Khz(ReadOnlySpan<short> input, int inputSampleRate)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(inputSampleRate);
        if (input.IsEmpty) return [];
        if (inputSampleRate == 16_000) return input.ToArray();

        var outputLength = checked((int)Math.Round(input.Length * (16_000d / inputSampleRate)));
        var output = new short[outputLength];
        var sourceStep = inputSampleRate / 16_000d;
        for (var outputIndex = 0; outputIndex < output.Length; outputIndex++)
        {
            var sourcePosition = outputIndex * sourceStep;
            var lowerIndex = Math.Min((int)sourcePosition, input.Length - 1);
            var upperIndex = Math.Min(lowerIndex + 1, input.Length - 1);
            var fraction = sourcePosition - lowerIndex;
            var interpolated = input[lowerIndex] + ((input[upperIndex] - input[lowerIndex]) * fraction);
            output[outputIndex] = (short)Math.Clamp(Math.Round(interpolated), short.MinValue, short.MaxValue);
        }
        return output;
    }

    private float PredictCadence()
    {
        var context = new float[MelContextSamples];
        var samples = _rawHistory.TakeLast(MelContextSamples).ToArray();
        var offset = context.Length - samples.Length;
        for (var index = 0; index < samples.Length; index++) context[offset + index] = samples[index];

        var melInputName = _melSession.InputMetadata.Single().Key;
        using (var outputs = _melSession.Run([NamedOnnxValue.CreateFromTensor(melInputName, new DenseTensor<float>(context, [1, context.Length]))]))
        {
            var mel = outputs.First().AsTensor<float>().ToArray();
            for (var start = 0; start + MelBins <= mel.Length; start += MelBins)
            {
                var row = new float[MelBins];
                for (var bin = 0; bin < MelBins; bin++) row[bin] = mel[start + bin] / 10f + 2f;
                _melHistory.Enqueue(row);
            }
        }
        while (_melHistory.Count > 970) _melHistory.Dequeue();

        var recentMel = _melHistory.TakeLast(MelFrames).ToArray();
        var embeddingValues = new float[MelFrames * MelBins];
        for (var row = 0; row < MelFrames; row++) recentMel[row].CopyTo(embeddingValues, row * MelBins);
        var embeddingInputName = _embeddingSession.InputMetadata.Single().Key;
        using (var outputs = _embeddingSession.Run([NamedOnnxValue.CreateFromTensor(embeddingInputName, new DenseTensor<float>(embeddingValues, [1, MelFrames, MelBins, 1]))]))
        {
            _featureHistory.Enqueue(outputs.First().AsTensor<float>().ToArray().TakeLast(EmbeddingWidth).ToArray());
        }
        while (_featureHistory.Count > 120) _featureHistory.Dequeue();

        var recentFeatures = _featureHistory.TakeLast(ClassifierFrames).ToArray();
        var classifierValues = new float[ClassifierFrames * EmbeddingWidth];
        for (var row = 0; row < ClassifierFrames; row++) recentFeatures[row].CopyTo(classifierValues, row * EmbeddingWidth);
        var classifierInputName = _classifierSession.InputMetadata.Single().Key;
        using var classifierOutputs = _classifierSession.Run([NamedOnnxValue.CreateFromTensor(classifierInputName, new DenseTensor<float>(classifierValues, [1, ClassifierFrames, EmbeddingWidth]))]);
        return classifierOutputs.SelectMany(value => value.AsEnumerable<float>()).DefaultIfEmpty().Max();
    }

    public async IAsyncEnumerable<WakeWordDetection> Detections([EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await foreach (var value in _detections.Reader.ReadAllAsync(cancellationToken)) yield return value;
    }

    public void SetSuppressed(bool suppressed) => _suppressed = suppressed;

    public async Task StopAsync(CancellationToken cancellationToken = default)
    {
        _lifetime.Cancel();
        if (_pump is not null)
        {
            try { await _pump.WaitAsync(cancellationToken); } catch (OperationCanceledException) { }
            _pump = null;
        }
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync();
        _detections.Writer.TryComplete();
        _melSession.Dispose();
        _embeddingSession.Dispose();
        _classifierSession.Dispose();
        _lifetime.Dispose();
    }
}
