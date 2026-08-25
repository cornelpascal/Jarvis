using Jarvis.Infrastructure;
using Jarvis.Protocol;

namespace Jarvis.Tests;

public sealed class WakeWordPipelineTests
{
    [Fact]
    public async Task DownsamplesShared24KhzCaptureTo1280SampleWakeWordCadence()
    {
        var modelDirectory = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,
            "..", "..", "..", "..", "..", "src", "Jarvis.App", "Assets", "WakeWord"));
        await using var detector = new OnnxWakeWordDetector(modelDirectory);
        await detector.StartAsync(Silence24Khz());
        await detector.StopAsync();
    }

    [Fact]
    public void ResamplesOne80MillisecondFrameWithoutChangingItsDuration()
    {
        var input = new short[WindowsAudioCaptureService.CaptureSamplesPerQuantum];

        var output = OnnxWakeWordDetector.ResampleTo16Khz(input, WindowsAudioCaptureService.CaptureSampleRate);

        Assert.Equal(1_280, output.Length);
        Assert.Equal(24_000, RealtimeTranscriptionSession.PcmSampleRate);
    }

    private static async IAsyncEnumerable<AudioFrame> Silence24Khz()
    {
        yield return new AudioFrame(new byte[3_840], 24_000, 1, 0, DateTimeOffset.UtcNow);
        await Task.CompletedTask;
    }
}
