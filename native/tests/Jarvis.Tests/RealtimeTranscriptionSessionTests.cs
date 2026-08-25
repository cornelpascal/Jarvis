using System.Text.Json;
using Jarvis.Infrastructure;

namespace Jarvis.Tests;

public sealed class RealtimeTranscriptionSessionTests
{
    [Theory]
    [InlineData("{\"type\":\"conversation.item.input_audio_transcription.delta\",\"delta\":\"Jarvis, \"}", "transcript_delta", "Jarvis, ")]
    [InlineData("{\"type\":\"conversation.item.input_audio_transcription.completed\",\"transcript\":\"Jarvis, open the project\"}", "transcript", "Jarvis, open the project")]
    public void ParseServerEvent_ProjectsTranscriptText(string json, string expectedType, string expectedText)
    {
        using var document = JsonDocument.Parse(json);

        var result = RealtimeTranscriptionSession.ParseServerEvent(document.RootElement);

        Assert.NotNull(result);
        Assert.Equal(expectedType, result.Type);
        Assert.Equal(expectedText, result.Transcript);
    }

    [Theory]
    [InlineData("input_audio_buffer.speech_started", "speech_started")]
    [InlineData("input_audio_buffer.speech_stopped", "speech_stopped")]
    public void ParseServerEvent_ProjectsSpeechBoundaries(string serverType, string expectedType)
    {
        using var document = JsonDocument.Parse($"{{\"type\":\"{serverType}\"}}");

        var result = RealtimeTranscriptionSession.ParseServerEvent(document.RootElement);

        Assert.NotNull(result);
        Assert.Equal(expectedType, result.Type);
    }
}
