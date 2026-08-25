using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Text;
using System.Threading.Channels;
using Jarvis.Protocol;

namespace Jarvis.Infrastructure;

public sealed class ProcessTerminalSession : ITerminalSession
{
    private readonly Channel<TerminalChunk> _output = Channel.CreateBounded<TerminalChunk>(new BoundedChannelOptions(2_048)
    {
        FullMode = BoundedChannelFullMode.DropOldest,
        SingleReader = false,
        SingleWriter = false,
    });
    private Process? _process;

    public string Id { get; } = Guid.NewGuid().ToString();
    public bool IsRunning => _process is { HasExited: false };

    public Task StartAsync(string executable, IReadOnlyList<string> arguments, string workingDirectory, int columns = 120, int rows = 32, CancellationToken cancellationToken = default)
    {
        if (IsRunning)
        {
            throw new InvalidOperationException("Terminal is already running.");
        }
        var start = new ProcessStartInfo
        {
            FileName = executable,
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardInputEncoding = new UTF8Encoding(false),
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var argument in arguments)
        {
            start.ArgumentList.Add(argument);
        }
        _process = Process.Start(start) ?? throw new InvalidOperationException("Terminal process failed to start.");
        _process.EnableRaisingEvents = true;
        _process.Exited += (_, _) => _output.Writer.TryComplete();
        _ = PumpAsync(_process.StandardOutput, "stdout", cancellationToken);
        _ = PumpAsync(_process.StandardError, "stderr", cancellationToken);
        return Task.CompletedTask;
    }

    private async Task PumpAsync(StreamReader reader, string stream, CancellationToken cancellationToken)
    {
        var buffer = new char[4_096];
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var count = await reader.ReadAsync(buffer.AsMemory(), cancellationToken);
                if (count == 0)
                {
                    break;
                }
                await _output.Writer.WriteAsync(new TerminalChunk(Id, stream, new string(buffer, 0, count), DateTimeOffset.UtcNow), cancellationToken);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
    }

    public async IAsyncEnumerable<TerminalChunk> Output([EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await foreach (var chunk in _output.Reader.ReadAllAsync(cancellationToken))
        {
            yield return chunk;
        }
    }

    public async Task WriteAsync(string input, CancellationToken cancellationToken = default)
    {
        if (_process is not { HasExited: false } process)
        {
            throw new InvalidOperationException("Terminal is not running.");
        }
        await process.StandardInput.WriteAsync(input.AsMemory(), cancellationToken);
        await process.StandardInput.FlushAsync(cancellationToken);
    }

    public Task ResizeAsync(int columns, int rows, CancellationToken cancellationToken = default)
    {
        // Redirected-process fallback has no PTY resize operation. ConPTY is used by
        // the native terminal host when interactive screen-buffer semantics are needed.
        return Task.CompletedTask;
    }

    public async Task CancelAsync(CancellationToken cancellationToken = default)
    {
        if (_process is { HasExited: false } process)
        {
            process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync(cancellationToken);
        }
    }

    public async ValueTask DisposeAsync()
    {
        await CancelAsync();
        _process?.Dispose();
        _output.Writer.TryComplete();
    }
}
