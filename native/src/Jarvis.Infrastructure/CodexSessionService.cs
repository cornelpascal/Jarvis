using System.Text.Json;
using Jarvis.Core;
using Jarvis.Protocol;

namespace Jarvis.Infrastructure;

public sealed class CodexSessionService : IAsyncDisposable
{
    private readonly ICodexAppServerClient _client;
    private readonly IJarvisEventBus _events;
    private readonly IReadOnlyList<string> _skillPaths;
    private readonly Dictionary<string, string> _threadTasks = [];
    private readonly Dictionary<string, string> _latestDiffs = [];
    private bool _initialized;

    public CodexSessionService(ICodexAppServerClient client, IJarvisEventBus events, IReadOnlyList<string>? skillPaths = null)
    {
        _client = client;
        _events = events;
        _skillPaths = skillPaths ?? [];
        _client.Notification += NotificationReceived;
        _client.StandardError += StandardErrorReceived;
    }

    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        if (_initialized)
        {
            return;
        }
        await _client.StartAsync(cancellationToken);
        await _client.InitializeProtocolAsync(
            new { name = "jarvis", title = "JARVIS", version = "0.2.0-native" },
            new { experimentalApi = true, requestAttestation = false }, cancellationToken);
        _initialized = true;
    }

    public async Task<(string ThreadId, string TurnId)> StartAsync(
        string taskId,
        string projectId,
        string workingDirectory,
        string instruction,
        CancellationToken cancellationToken = default)
    {
        await InitializeAsync(cancellationToken);
        var thread = await _client.StartThreadAsync(CodexThreadOptions.Create(workingDirectory, _skillPaths), cancellationToken);
        var threadId = NestedString(thread, "thread", "id")
            ?? throw new InvalidOperationException("thread/start returned no thread id.");
        _threadTasks[threadId] = taskId;
        await _events.PublishAsync("codex.agent.started", "codex.native", new
        {
            agentRunId = Guid.NewGuid().ToString(), taskId, projectId, threadId,
        }, taskId, projectId, cancellationToken);
        var turnId = await StartTurnAsync(threadId, workingDirectory, instruction, cancellationToken);
        return (threadId, turnId);
    }

    public async Task<string> StartTurnAsync(string threadId, string workingDirectory, string instruction, CancellationToken cancellationToken = default)
    {
        var result = await _client.StartTurnAsync(threadId, workingDirectory, instruction, cancellationToken);
        return NestedString(result, "turn", "id")
            ?? throw new InvalidOperationException("turn/start returned no turn id.");
    }

    public Task SteerAsync(string threadId, string turnId, string instruction, CancellationToken cancellationToken = default) =>
        _client.SteerTurnAsync(threadId, turnId, instruction, cancellationToken);

    public Task InterruptAsync(string threadId, string turnId, CancellationToken cancellationToken = default) =>
        _client.InterruptTurnAsync(threadId, turnId, cancellationToken);

    public async Task ResumeAsync(string taskId, string threadId, string workingDirectory, CancellationToken cancellationToken = default)
    {
        await InitializeAsync(cancellationToken);
        await _client.ResumeThreadAsync(threadId, CodexThreadOptions.Create(workingDirectory, _skillPaths), cancellationToken);
        _threadTasks[threadId] = taskId;
    }

    public Task<JsonElement> ReadThreadAsync(string threadId, CancellationToken cancellationToken = default) =>
        _client.ReadThreadAsync(threadId, includeTurns: true, cancellationToken);

    public string RequestLatestDiff(string threadId) => _latestDiffs.TryGetValue(threadId, out var diff) ? diff : string.Empty;

    private void NotificationReceived(object? sender, CodexNotification notification) =>
        _ = ProjectNotificationAsync(notification);

    private async Task ProjectNotificationAsync(CodexNotification notification)
    {
        var parameters = notification.Parameters;
        var threadId = parameters is { } value ? NestedString(value, "threadId") : null;
        if (threadId is null || !_threadTasks.TryGetValue(threadId, out var taskId))
        {
            return;
        }
        var projectId = parameters is { } element ? NestedString(element, "projectId") ?? "anywhere" : "anywhere";
        if (notification.Method == "item/agentMessage/delta")
        {
            var delta = parameters is { } deltaElement ? NestedString(deltaElement, "delta") : null;
            if (!string.IsNullOrEmpty(delta))
            {
                await _events.PublishAsync("conversation.message.delta", "codex.native", new
                {
                    messageId = taskId, taskId, projectId, content = delta,
                }, taskId, projectId);
            }
            return;
        }

        var detail = parameters?.GetRawText();
        if (notification.Method == "turn/diff/updated" && detail is not null)
        {
            _latestDiffs[threadId] = detail;
        }
        var kind = notification.Method switch
        {
            "turn/diff/updated" => "diff",
            "turn/completed" => "state",
            _ when notification.Method.StartsWith("item/", StringComparison.Ordinal) => "item",
            _ => "state",
        };
        await _events.PublishAsync("codex.terminal", "codex.native", new
        {
            taskId,
            projectId,
            kind,
            label = notification.Method,
            detail = detail is { Length: > 20_000 } ? detail[..20_000] : detail,
        }, taskId, projectId);
    }

    private void StandardErrorReceived(object? sender, string line) =>
        _ = _events.PublishAsync("codex.terminal", "codex.stderr", new
        {
            taskId = "system", projectId = "anywhere", kind = "error", label = "Codex App Server", detail = line,
        });

    internal static string? NestedString(JsonElement value, params string[] path)
    {
        var current = value;
        foreach (var key in path)
        {
            if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(key, out current))
            {
                return null;
            }
        }
        return current.ValueKind == JsonValueKind.String ? current.GetString() : null;
    }

    public async ValueTask DisposeAsync()
    {
        _client.Notification -= NotificationReceived;
        _client.StandardError -= StandardErrorReceived;
        await _client.DisposeAsync();
    }
}
