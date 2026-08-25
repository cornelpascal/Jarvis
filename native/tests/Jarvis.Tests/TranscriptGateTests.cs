using Jarvis.Core;

namespace Jarvis.Tests;

public sealed class TranscriptGateTests
{
    [Theory]
    [InlineData("Hey Jarvis, finish the implementation", "finish the implementation")]
    [InlineData("Jarvis run the tests", "run the tests")]
    [InlineData("Could you help, Jarvis?", "Could you help, Jarvis?")]
    public void ExtractsWholeWordAddress(string transcript, string expected)
    {
        Assert.True(TranscriptGate.TryExtractCommand(transcript, out var command));
        Assert.Equal(expected, command);
    }

    [Theory]
    [InlineData("run the tests")]
    [InlineData("jarvisian command")]
    [InlineData("")]
    public void RejectsTranscriptWithoutWholeWordJarvis(string transcript) =>
        Assert.False(TranscriptGate.TryExtractCommand(transcript, out _));
}
