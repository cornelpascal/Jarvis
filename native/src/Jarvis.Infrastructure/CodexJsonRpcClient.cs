using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Jarvis.Protocol;

namespace Jarvis.Infrastructure;

public sealed class CodexJsonRpcClient : ICodexAppServerClient
{
    private sealed record Pending(TaskCompletionSource<JsonElement> Completion, CancellationTokenSource Timeout);

    private readonly string _executable;
    private readonly IReadOnlyList<string> _argumentPrefix;
    private readonly ConcurrentDictionary<long, Pending> _pending = new();
    private readonly SemaphoreSlim _writeLock = new(1, 1);
    private readonly CancellationTokenSource _lifetime = new();
    private Process? _process;
    private Task? _stdoutPump;
    private Task? _stderrPump;
    private long _nextId;

    public CodexJsonRpcClient(string executable = "codex", IReadOnlyList<string>? argumentPrefix = null)
    {
        _executable = executable;
        _argumentPrefix = argumentPrefix ?? [];
    }

    public event EventHandler<CodexNotification>? Notification;
    public event EventHandler<string>? StandardError;
    public bool IsRunning => _process is { HasExited: false };

    public Task StartAsync(CancellationToken cancellationToken = default)
    {
        if (IsRunning)
        {
            return Task.CompletedTask;
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = _executable,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardInputEncoding = new UTF8Encoding(false),
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var argument in _argumentPrefix)
        {
            startInfo.ArgumentList.Add(argument);
        }
        startInfo.ArgumentList.Add("app-server");
        startInfo.ArgumentList.Add("--stdio");

        _process = Process.Start(startInfo) ?? throw new InvalidOperationException("Codex App Server failed to start.");
        _process.EnableRaisingEvents = true;
        _process.Exited += ProcessExited;
        _stdoutPump = PumpStandardOutputAsync(_process, _lifetime.Token);
        _stderrPump = PumpStandardErrorAsync(_process, _lifetime.Token);
        return Task.CompletedTask;
    }

    public async Task<JsonElement> RequestAsync(
        string method,
        object? parameters,
        TimeSpan? timeout = null,
        CancellationToken cancellationToken = default)
    {
        await StartAsync(cancellationToken);
        var id = Interlocked.Increment(ref _nextId);
        var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, _lifetime.Token);
        timeoutSource.CancelAfter(timeout ?? TimeSpan.FromSeconds(30));
        var completion = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        var pending = new Pending(completion, timeoutSource);
        if (!_pending.TryAdd(id, pending))
        {
            timeoutSource.Dispose();
            throw new InvalidOperationException("Duplicate Codex request id.");
        }

        using var registration = timeoutSource.Token.Register(() =>
        {
            if (_pending.TryRemove(id, out var removed))
            {
                removed.Completion.TrySetException(new TimeoutException($"Codex request timed out: {method}"));
                removed.Timeout.Dispose();
            }
        });

        await WriteAsync(new { id, method, @params = parameters ?? new { } }, cancellationToken);
        return await completion.Task.ConfigureAwait(false);
    }

    public async Task<JsonElement> InitializeProtocolAsync(object clientInfo, object capabilities, CancellationToken cancellationToken = default)
    {
        var result = await RequestAsync("initialize", new { clientInfo, capabilities }, cancellationToken: cancellationToken);
        await NotifyAsync("initialized", new { }, cancellationToken);
        return result;
    }

    public Task<JsonElement> StartThreadAsync(object options, CancellationToken cancellationToken = default) =>
        RequestAsync("thread/start", options, cancellationToken: cancellationToken);

    public Task<JsonElement> ResumeThreadAsync(string threadId, object options, CancellationToken cancellationToken = default) =>
        RequestAsync("thread/resume", MergeWithThreadId(threadId, options), cancellationToken: cancellationToken);

    public Task<JsonElement> StartTurnAsync(string threadId, string workingDirectory, string instruction, CancellationToken cancellationToken = default) =>
        RequestAsync("turn/start", new
        {
            threadId,
            input = new[] { new { type = "text", text = instruction, text_elements = Array.Empty<object>() } },
            cwd = workingDirectory,
            approvalPolicy = "never",
            sandboxPolicy = new { type = "dangerFullAccess" },
        }, cancellationToken: cancellationToken);

    public Task<JsonElement> SteerTurnAsync(string threadId, string turnId, string instruction, CancellationToken cancellationToken = default) =>
        RequestAsync("turn/steer", new
        {
            threadId,
            expectedTurnId = turnId,
            input = new[] { new { type = "text", text = instruction, text_elements = Array.Empty<object>() } },
        }, cancellationToken: cancellationToken);

    public Task<JsonElement> InterruptTurnAsync(string threadId, string turnId, CancellationToken cancellationToken = default) =>
        RequestAsync("turn/interrupt", new { threadId, turnId }, cancellationToken: cancellationToken);

    public Task<JsonElement> ReadThreadAsync(string threadId, bool includeTurns = true, CancellationToken cancellationToken = default) =>
        RequestAsync("thread/read", new { threadId, includeTurns }, cancellationToken: cancellationToken);

    private static Dictionary<string, object?> MergeWithThreadId(string threadId, object options)
    {
        var result = JsonSerializer.Deserialize<Dictionary<string, object?>>(JsonSerializer.Serialize(options, JarvisJson.Options), JarvisJson.Options) ?? [];
        result["threadId"] = threadId;
        return result;
    }

    public Task NotifyAsync(string method, object? parameters, CancellationToken cancellationToken = default) =>
        WriteAsync(new { method, @params = parameters ?? new { } }, cancellationToken);

    private async Task WriteAsync(object message, CancellationToken cancellationToken)
    {
        var process = _process;
        if (process is null || process.HasExited)
        {
            throw new InvalidOperationException("Codex App Server is unavailable.");
        }

        var json = JsonSerializer.Serialize(message, JarvisJson.Options);
        await _writeLock.WaitAsync(cancellationToken);
        try
        {
            await process.StandardInput.WriteLineAsync(json.AsMemory(), cancellationToken);
            await process.StandardInput.FlushAsync(cancellationToken);
        }
        finally
        {
            _writeLock.Release();
        }
    }

    private async Task PumpStandardOutputAsync(Process process, CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var line = await process.StandardOutput.ReadLineAsync(cancellationToken);
                if (line is null)
                {
                    break;
                }
                if (string.IsNullOrWhiteSpace(line))
                {
                    continue;
                }

                using var document = JsonDocument.Parse(line);
                var root = document.RootElement;
                if (root.TryGetProperty("id", out var idProperty) && idProperty.TryGetInt64(out var id))
                {
                    if (root.TryGetProperty("method", out var serverMethod))
                    {
                        await WriteAsync(new
                        {
                            id,
                            error = new { code = -32001, message = $"Unexpected server request: {serverMethod.GetString()}" },
                        }, cancellationToken);
                        continue;
                    }
                    if (!_pending.TryRemove(id, out var pending))
                    {
                        continue;
                    }

                    pending.Timeout.Dispose();
                    if (root.TryGetProperty("error", out var error))
                    {
                        var code = error.TryGetProperty("code", out var codeProperty) ? codeProperty.GetRawText() : "unknown";
                        var message = error.TryGetProperty("message", out var messageProperty) ? messageProperty.GetString() : "Unknown Codex error";
                        pending.Completion.TrySetException(new InvalidOperationException($"Codex {code}: {message}"));
                    }
                    else
                    {
                        var result = root.TryGetProperty("result", out var resultProperty)
                            ? resultProperty.Clone()
                            : JsonSerializer.SerializeToElement(new { });
                        pending.Completion.TrySetResult(result);
                    }
                    continue;
                }

                if (root.TryGetProperty("method", out var methodProperty))
                {
                    var parameters = root.TryGetProperty("params", out var parametersProperty)
                        ? parametersProperty.Clone()
                        : (JsonElement?)null;
                    Notification?.Invoke(this, new CodexNotification(methodProperty.GetString() ?? "unknown", parameters));
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception error)
        {
            FailPending(error);
        }
    }

    private async Task PumpStandardErrorAsync(Process process, CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var line = await process.StandardError.ReadLineAsync(cancellationToken);
                if (line is null)
                {
                    break;
                }
                StandardError?.Invoke(this, line);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
    }

    private void ProcessExited(object? sender, EventArgs args) =>
        FailPending(new InvalidOperationException($"Codex App Server exited ({_process?.ExitCode.ToString() ?? "unknown"})."));

    private void FailPending(Exception error)
    {
        foreach (var pair in _pending.ToArray())
        {
            if (_pending.TryRemove(pair.Key, out var pending))
            {
                pending.Timeout.Dispose();
                pending.Completion.TrySetException(error);
            }
        }
    }

    public async ValueTask DisposeAsync()
    {
        _lifetime.Cancel();
        var process = _process;
        _process = null;
        if (process is { HasExited: false })
        {
            process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync();
        }
        if (_stdoutPump is not null)
        {
            await IgnoreCancellation(_stdoutPump);
        }
        if (_stderrPump is not null)
        {
            await IgnoreCancellation(_stderrPump);
        }
        FailPending(new ObjectDisposedException(nameof(CodexJsonRpcClient)));
        process?.Dispose();
        _writeLock.Dispose();
        _lifetime.Dispose();
    }

    private static async Task IgnoreCancellation(Task task)
    {
        try
        {
            await task;
        }
        catch (OperationCanceledException)
        {
        }
    }
}
