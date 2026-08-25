using Jarvis.Infrastructure;

namespace Jarvis.Tests;

public sealed class CodexJsonRpcClientTests
{
    [Fact]
    public async Task ParsesCombinedAndFragmentedJsonLines()
    {
        var script = Path.Combine(AppContext.BaseDirectory, "Fixtures", "fake-codex-app-server.ps1");
        await using var client = new CodexJsonRpcClient(
            "powershell.exe", ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script]);
        var notification = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        client.Notification += (_, value) => notification.TrySetResult(value.Method);

        var result = await client.RequestAsync("thread/start", new { }, TimeSpan.FromSeconds(5));

        Assert.Equal("thread-test", result.GetProperty("thread").GetProperty("id").GetString());
        Assert.Equal("turn/delta", await notification.Task.WaitAsync(TimeSpan.FromSeconds(5)));
    }
}
