using System.Net.WebSockets;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Jarvis.Protocol;

namespace Jarvis.Infrastructure;

public sealed class SonioxTranscriptionSession : IRealtimeTranscriptionSession
{
    public const int PcmSampleRate = 24_000;
    private static readonly Uri Endpoint = new("wss://stt-rt.soniox.com/transcribe-websocket");
    private readonly string _apiKey;
    private readonly string _model;
    private readonly IReadOnlyList<string> _languageHints;
    private readonly Channel<TranscriptionEvent> _events = Channel.CreateBounded<TranscriptionEvent>(128);
    private readonly CancellationTokenSource _lifetime = new();
    private readonly StringBuilder _finalTranscript = new();
    private ClientWebSocket? _socket;
    private Task? _sendTask;
    private Task? _receiveTask;
    private bool _speechActive;

    public SonioxTranscriptionSession(string apiKey, string model = "stt-rt-v5", IReadOnlyList<string>? languageHints = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(apiKey);
        _apiKey = apiKey;
        _model = model;
        _languageHints = languageHints ?? ["ro", "en"];
    }

    public async Task StartAsync(IAsyncEnumerable<AudioFrame> frames, CancellationToken cancellationToken = default)
    {
        if (_socket is not null) return;
        _socket = new ClientWebSocket();
        await _socket.ConnectAsync(Endpoint, cancellationToken);
        await SendJsonAsync(new
        {
            api_key = _apiKey,
            model = _model,
            audio_format = "pcm_s16le",
            sample_rate = PcmSampleRate,
            num_channels = 1,
            language_hints = _languageHints,
            enable_endpoint_detection = true,
            max_endpoint_delay_ms = 1_500,
            endpoint_sensitivity = 0.3,
            endpoint_latency_adjustment_level = 1,
            context = new { terms = new[] { "Jarvis", "Codex", "Soniox" } },
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
            if (_socket is not { State: WebSocketState.Open } socket) break;
            await socket.SendAsync(frame.Pcm16, WebSocketMessageType.Binary, true, cancellationToken);
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
                if (result.MessageType == WebSocketMessageType.Close) break;
                message.Write(buffer, 0, result.Count);
                if (!result.EndOfMessage) continue;
                using var document = JsonDocument.Parse(message.ToArray());
                message.SetLength(0);
                await ProjectResponseAsync(ParseServerResponse(document.RootElement), cancellationToken);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
        catch (Exception error)
        {
            _events.Writer.TryWrite(new TranscriptionEvent("error", Error: error.Message));
        }
    }

    private async Task ProjectResponseAsync(SonioxResponse response, CancellationToken cancellationToken)
    {
        if (response.Error is not null)
        {
            await _events.Writer.WriteAsync(new TranscriptionEvent("error", Error: response.Error), cancellationToken);
            return;
        }
        if (!_speechActive && (response.FinalText.Length > 0 || response.NonFinalText.Length > 0))
        {
            _speechActive = true;
            await _events.Writer.WriteAsync(new TranscriptionEvent("speech_started"), cancellationToken);
        }
        _finalTranscript.Append(response.FinalText);
        var preview = _finalTranscript.ToString() + response.NonFinalText;
        if (preview.Length > 0)
        {
            await _events.Writer.WriteAsync(new TranscriptionEvent("transcript_delta", preview), cancellationToken);
        }
        if (!response.Endpoint) return;
        _speechActive = false;
        await _events.Writer.WriteAsync(new TranscriptionEvent("speech_stopped"), cancellationToken);
        var transcript = _finalTranscript.ToString().Trim();
        _finalTranscript.Clear();
        if (transcript.Length > 0)
        {
            await _events.Writer.WriteAsync(new TranscriptionEvent("transcript", transcript), cancellationToken);
        }
    }

    internal static SonioxResponse ParseServerResponse(JsonElement root)
    {
        if (root.TryGetProperty("error_code", out _))
        {
            var type = root.TryGetProperty("error_type", out var errorType) ? errorType.GetString() : "soniox_error";
            var message = root.TryGetProperty("error_message", out var errorMessage) ? errorMessage.GetString() : root.GetRawText();
            return new SonioxResponse("", "", false, $"{type}: {message}");
        }
        var final = new StringBuilder();
        var nonFinal = new StringBuilder();
        var endpoint = false;
        if (root.TryGetProperty("tokens", out var tokens) && tokens.ValueKind == JsonValueKind.Array)
        {
            foreach (var token in tokens.EnumerateArray())
            {
                var text = token.TryGetProperty("text", out var textValue) ? textValue.GetString() ?? "" : "";
                var isFinal = token.TryGetProperty("is_final", out var finalValue) && finalValue.GetBoolean();
                if (isFinal && text is "<end>" or "<fin>") { endpoint = true; continue; }
                if (isFinal) final.Append(text); else nonFinal.Append(text);
            }
        }
        return new SonioxResponse(final.ToString(), nonFinal.ToString(), endpoint, null);
    }

    private async Task SendJsonAsync(object value, CancellationToken cancellationToken)
    {
        if (_socket is not { State: WebSocketState.Open } socket) throw new InvalidOperationException("Soniox socket is not connected.");
        await socket.SendAsync(JsonSerializer.SerializeToUtf8Bytes(value, JarvisJson.Options), WebSocketMessageType.Text, true, cancellationToken);
    }

    public async IAsyncEnumerable<TranscriptionEvent> Events([EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await foreach (var value in _events.Reader.ReadAllAsync(cancellationToken)) yield return value;
    }

    public async Task StopAsync(CancellationToken cancellationToken = default)
    {
        if (_socket is { State: WebSocketState.Open } socket)
        {
            await socket.SendAsync(ReadOnlyMemory<byte>.Empty, WebSocketMessageType.Binary, true, cancellationToken);
            await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "Jarvis voice stopped", cancellationToken);
        }
        _lifetime.Cancel();
        if (_sendTask is not null) await IgnoreCancellation(_sendTask);
        if (_receiveTask is not null) await IgnoreCancellation(_receiveTask);
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
        try { await task; } catch (OperationCanceledException) { }
    }
}

internal sealed record SonioxResponse(string FinalText, string NonFinalText, bool Endpoint, string? Error);
