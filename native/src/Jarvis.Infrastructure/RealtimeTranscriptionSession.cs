using System.Net.WebSockets;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Jarvis.Protocol;

namespace Jarvis.Infrastructure;

public sealed class RealtimeTranscriptionSession : IRealtimeTranscriptionSession
{
    public const int PcmSampleRate = 24_000;
    private readonly string _apiKey;
    private readonly string _model;
    private readonly string _transcriptionModel;
    private readonly int _silenceDurationMilliseconds;
    private readonly Channel<TranscriptionEvent> _events = Channel.CreateBounded<TranscriptionEvent>(new BoundedChannelOptions(128)
    {
        FullMode = BoundedChannelFullMode.DropOldest,
        SingleReader = false,
        SingleWriter = false,
    });
    private readonly CancellationTokenSource _lifetime = new();
    private ClientWebSocket? _socket;
    private Task? _sendTask;
    private Task? _receiveTask;

    public RealtimeTranscriptionSession(string apiKey, string model, string transcriptionModel, int silenceDurationMilliseconds = 1_000)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(apiKey);
        _apiKey = apiKey;
        _model = model;
        _transcriptionModel = transcriptionModel;
        _silenceDurationMilliseconds = silenceDurationMilliseconds;
    }

    public async Task StartAsync(IAsyncEnumerable<AudioFrame> frames, CancellationToken cancellationToken = default)
    {
        if (_socket is not null)
        {
            return;
        }
        _socket = new ClientWebSocket();
        _socket.Options.SetRequestHeader("Authorization", $"Bearer {_apiKey}");
        await _socket.ConnectAsync(new Uri($"wss://api.openai.com/v1/realtime?model={Uri.EscapeDataString(_model)}"), cancellationToken);
        await SendJsonAsync(new
        {
            type = "session.update",
            session = new
            {
                type = "realtime",
                instructions = "Transcribe the user's speech accurately. Do not answer the user; JARVIS forwards the transcript to Codex.",
                audio = new
                {
                    input = new
                    {
                        format = new { type = "audio/pcm", rate = PcmSampleRate },
                        noise_reduction = new { type = "near_field" },
                        transcription = new { model = _transcriptionModel },
                        turn_detection = new
                        {
                            type = "server_vad",
                            threshold = 0.5,
                            prefix_padding_ms = 300,
                            silence_duration_ms = _silenceDurationMilliseconds,
                            create_response = false,
                            interrupt_response = false,
                        },
                    },
                },
            },
        }, cancellationToken);
        var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, _lifetime.Token);
        _sendTask = SendAudioAsync(frames, linked.Token);
        _receiveTask = ReceiveAsync(linked.Token);
        await _events.Writer.WriteAsync(new TranscriptionEvent("connected"), cancellationToken);
    }

    private async Task SendAudioAsync(IAsyncEnumerable<AudioFrame> frames, CancellationToken cancellationToken)
    {
        await foreach (var frame in frames.WithCancellation(cancellationToken))
        {
            await SendJsonAsync(new
            {
                type = "input_audio_buffer.append",
                audio = Convert.ToBase64String(frame.Pcm16.Span),
            }, cancellationToken);
        }
    }

    private async Task ReceiveAsync(CancellationToken cancellationToken)
    {
        var buffer = new byte[64 * 1024];
        using var message = new MemoryStream();
        try
        {
            while (_socket is { State: WebSocketState.Open } socket && !cancellationToken.IsCancellationRequested)
            {
                var result = await socket.ReceiveAsync(buffer, cancellationToken);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    break;
                }
                message.Write(buffer, 0, result.Count);
                if (!result.EndOfMessage)
                {
                    continue;
                }
                using var document = JsonDocument.Parse(message.ToArray());
                message.SetLength(0);
                if (ParseServerEvent(document.RootElement) is { } transcriptionEvent)
                {
                    await _events.Writer.WriteAsync(transcriptionEvent, cancellationToken);
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception error)
        {
            _events.Writer.TryWrite(new TranscriptionEvent("error", Error: error.Message));
        }
    }

    internal static TranscriptionEvent? ParseServerEvent(JsonElement root)
    {
        var type = root.TryGetProperty("type", out var typeValue) ? typeValue.GetString() : null;
        return type switch
        {
            "input_audio_buffer.speech_started" => new TranscriptionEvent("speech_started"),
            "input_audio_buffer.speech_stopped" => new TranscriptionEvent("speech_stopped"),
            "conversation.item.input_audio_transcription.delta" => new TranscriptionEvent(
                "transcript_delta",
                root.TryGetProperty("delta", out var deltaValue) ? deltaValue.GetString() : null),
            "conversation.item.input_audio_transcription.completed" => new TranscriptionEvent(
                "transcript",
                root.TryGetProperty("transcript", out var transcriptValue) ? transcriptValue.GetString() : null),
            "error" => new TranscriptionEvent(
                "error",
                Error: root.TryGetProperty("error", out var errorValue) ? errorValue.GetRawText() : root.GetRawText()),
            _ => null,
        };
    }

    private async Task SendJsonAsync(object value, CancellationToken cancellationToken)
    {
        if (_socket is not { State: WebSocketState.Open } socket)
        {
            throw new InvalidOperationException("Realtime transcription socket is not connected.");
        }
        var data = JsonSerializer.SerializeToUtf8Bytes(value, JarvisJson.Options);
        await socket.SendAsync(data, WebSocketMessageType.Text, true, cancellationToken);
    }

    public async IAsyncEnumerable<TranscriptionEvent> Events([EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await foreach (var value in _events.Reader.ReadAllAsync(cancellationToken))
        {
            yield return value;
        }
    }

    public async Task StopAsync(CancellationToken cancellationToken = default)
    {
        _lifetime.Cancel();
        if (_socket is { State: WebSocketState.Open } socket)
        {
            await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "Jarvis voice stopped", cancellationToken);
        }
        if (_sendTask is not null)
        {
            await IgnoreCancellation(_sendTask);
        }
        if (_receiveTask is not null)
        {
            await IgnoreCancellation(_receiveTask);
        }
        _socket?.Dispose();
        _socket = null;
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync();
        _events.Writer.TryComplete();
        _lifetime.Dispose();
    }

    private static async Task IgnoreCancellation(Task task)
    {
        try { await task; }
        catch (OperationCanceledException) { }
    }
}
