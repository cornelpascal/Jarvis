using Jarvis.Infrastructure;
using Windows.Media;

namespace Jarvis.Tests;

public sealed class WindowsAudioCaptureServiceTests
{
    [Fact]
    public void ReadsPcmBytesFromAWinRtAudioFrame()
    {
        using var frame = new Windows.Media.AudioFrame(16);
        using (var buffer = frame.LockBuffer(AudioBufferAccessMode.Write))
        {
            buffer.Length = 16;
        }

        var bytes = WindowsAudioCaptureService.CopyFrameBytes(frame);

        Assert.Equal(16, bytes.Length);
    }
}
