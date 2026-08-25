using Jarvis.Infrastructure;

namespace Jarvis.Tests;

public sealed class ConPtyTerminalSessionTests
{
    [Fact]
    public async Task StartsResizesStreamsAndCancels()
    {
        await using var terminal = new ConPtyTerminalSession();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        await terminal.StartAsync("ping.exe", ["-t", "127.0.0.1"], Path.GetTempPath(), 100, 30, timeout.Token);
        await terminal.ResizeAsync(132, 40, timeout.Token);
        Assert.True(terminal.IsRunning);
        await terminal.CancelAsync(timeout.Token);
        Assert.False(terminal.IsRunning);
    }

    [Fact]
    public async Task PassesChildArguments()
    {
        await using var terminal = new ConPtyTerminalSession();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        await terminal.StartAsync("cmd.exe", ["/d", "/c", "exit 42"], Path.GetTempPath(), cancellationToken: timeout.Token);
        await foreach (var _ in terminal.Output(timeout.Token)) { }
        Assert.True(terminal.ExitCode == 42, $"Command: {terminal.CommandLine}; exit code: {terminal.ExitCode}");
    }
}
