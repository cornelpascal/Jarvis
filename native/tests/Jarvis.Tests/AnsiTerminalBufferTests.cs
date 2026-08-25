using Jarvis.Infrastructure;

namespace Jarvis.Tests;

public sealed class AnsiTerminalBufferTests
{
    [Fact]
    public void RemovesFragmentedCsiAndOscWithoutLosingUnicode()
    {
        var buffer = new AnsiTerminalBuffer();

        buffer.Append("ready \u001b[3");
        buffer.Append("1mcyan\u001b[0m λ \u001b]0;title");
        buffer.Append("\u0007done");

        Assert.Equal("ready cyan λ done", buffer.Text);
    }

    [Fact]
    public void KeepsBoundedScrollback()
    {
        var buffer = new AnsiTerminalBuffer(5);
        buffer.Append("123");
        buffer.Append("4567");
        Assert.Equal("34567", buffer.Text);
    }
}
