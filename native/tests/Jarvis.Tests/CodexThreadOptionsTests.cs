using System.Text.Json;
using Jarvis.Core;
using Jarvis.Protocol;

namespace Jarvis.Tests;

public sealed class CodexThreadOptionsTests
{
    [Fact]
    public void UsesExactYoloSettings()
    {
        var value = CodexThreadOptions.Create("C:\\workspace", ["C:\\skills\\browser-check\\SKILL.md"]);
        var json = JsonSerializer.SerializeToElement(value, JarvisJson.Options);

        Assert.Equal("never", json.GetProperty("approvalPolicy").GetString());
        Assert.Equal("danger-full-access", json.GetProperty("sandbox").GetString());
        Assert.Equal("C:\\workspace", json.GetProperty("cwd").GetString());
        Assert.False(json.GetProperty("ephemeral").GetBoolean());
        Assert.Contains("SKILL.md", json.GetProperty("developerInstructions").GetString());
    }
}
