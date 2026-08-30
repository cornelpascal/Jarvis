using System.Text.Json;
using Jarvis.Infrastructure;

namespace Jarvis.Tests;

public sealed class SonioxTranscriptionSessionTests
{
    [Fact]
    public void ParsesFinalNonFinalAndEndpointTokens()
    {
        using var document = JsonDocument.Parse("""
            {"tokens":[
              {"text":"deschide ","is_final":true},
              {"text":"proiectul","is_final":false},
              {"text":"<end>","is_final":true}
            ]}
            """);

        var result = SonioxTranscriptionSession.ParseServerResponse(document.RootElement);

        Assert.Equal("deschide ", result.FinalText);
        Assert.Equal("proiectul", result.NonFinalText);
        Assert.True(result.Endpoint);
        Assert.Null(result.Error);
    }

    [Fact]
    public void ParsesStableSonioxErrorFields()
    {
        using var document = JsonDocument.Parse("""{"tokens":[],"error_code":401,"error_type":"unauthenticated","error_message":"Incorrect API key"}""");

        var result = SonioxTranscriptionSession.ParseServerResponse(document.RootElement);

        Assert.Equal("unauthenticated: Incorrect API key", result.Error);
    }
}
