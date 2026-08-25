using System.Text.Json;

namespace Jarvis.Protocol;

public interface IJarvisEventStore
{
    ValueTask<long> LatestSequenceAsync(CancellationToken cancellationToken = default);
    ValueTask AppendAsync(JarvisEvent value, CancellationToken cancellationToken = default);
    IAsyncEnumerable<JarvisEvent> ReadAfterAsync(long sequence, int limit, CancellationToken cancellationToken = default);
}

public interface IJarvisEventBus
{
    ValueTask<JarvisEvent> PublishAsync<T>(string type, string source, T payload, string? taskId = null, string? projectId = null, CancellationToken cancellationToken = default);
    IAsyncEnumerable<JarvisEvent> SubscribeAsync(long afterSequence = -1, CancellationToken cancellationToken = default);
}

public sealed record CodexNotification(string Method, JsonElement? Parameters);

public interface ICodexAppServerClient : IAsyncDisposable
{
    event EventHandler<CodexNotification>? Notification;
    event EventHandler<string>? StandardError;
    bool IsRunning { get; }
    Task StartAsync(CancellationToken cancellationToken = default);
    Task<JsonElement> InitializeProtocolAsync(object clientInfo, object capabilities, CancellationToken cancellationToken = default);
    Task<JsonElement> StartThreadAsync(object options, CancellationToken cancellationToken = default);
    Task<JsonElement> ResumeThreadAsync(string threadId, object options, CancellationToken cancellationToken = default);
    Task<JsonElement> StartTurnAsync(string threadId, string workingDirectory, string instruction, CancellationToken cancellationToken = default);
    Task<JsonElement> SteerTurnAsync(string threadId, string turnId, string instruction, CancellationToken cancellationToken = default);
    Task<JsonElement> InterruptTurnAsync(string threadId, string turnId, CancellationToken cancellationToken = default);
    Task<JsonElement> ReadThreadAsync(string threadId, bool includeTurns = true, CancellationToken cancellationToken = default);
    Task<JsonElement> RequestAsync(string method, object? parameters, TimeSpan? timeout = null, CancellationToken cancellationToken = default);
    Task NotifyAsync(string method, object? parameters, CancellationToken cancellationToken = default);
}

public interface IAudioCaptureService : IAsyncDisposable
{
    bool IsRunning { get; }
    IAsyncEnumerable<AudioFrame> Frames(CancellationToken cancellationToken = default);
    Task StartAsync(CancellationToken cancellationToken = default);
    Task StopAsync(CancellationToken cancellationToken = default);
}

public sealed record TranscriptionEvent(string Type, string? Transcript = null, string? Error = null);

public interface IRealtimeTranscriptionSession : IAsyncDisposable
{
    IAsyncEnumerable<TranscriptionEvent> Events(CancellationToken cancellationToken = default);
    Task StartAsync(IAsyncEnumerable<AudioFrame> frames, CancellationToken cancellationToken = default);
    Task StopAsync(CancellationToken cancellationToken = default);
}

public sealed record WakeWordDetection(string Phrase, float Score, DateTimeOffset Timestamp);

public interface IWakeWordDetector : IAsyncDisposable
{
    IAsyncEnumerable<WakeWordDetection> Detections(CancellationToken cancellationToken = default);
    Task StartAsync(IAsyncEnumerable<AudioFrame> frames, CancellationToken cancellationToken = default);
    Task StopAsync(CancellationToken cancellationToken = default);
    void SetSuppressed(bool suppressed);
}

public interface ITerminalSession : IAsyncDisposable
{
    string Id { get; }
    bool IsRunning { get; }
    IAsyncEnumerable<TerminalChunk> Output(CancellationToken cancellationToken = default);
    Task StartAsync(string executable, IReadOnlyList<string> arguments, string workingDirectory, int columns = 120, int rows = 32, CancellationToken cancellationToken = default);
    Task WriteAsync(string input, CancellationToken cancellationToken = default);
    Task ResizeAsync(int columns, int rows, CancellationToken cancellationToken = default);
    Task CancelAsync(CancellationToken cancellationToken = default);
}
