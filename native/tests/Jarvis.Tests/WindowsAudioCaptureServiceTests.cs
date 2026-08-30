using Jarvis.Infrastructure;
namespace Jarvis.Tests;

public sealed class WindowsAudioCaptureServiceTests
{
    [Fact]
    public void ReadsPcmBytesFromAWinRtAudioFrame()
    {
        using var frame = new Windows.Media.AudioFrame(16);
        using (var buffer = frame.LockBuffer(Windows.Media.AudioBufferAccessMode.Write))
        {
            buffer.Length = 16;
        }

        var bytes = WindowsAudioCaptureService.CopyFrameBytes(frame);

        Assert.Equal(16, bytes.Length);
    }

    [Fact]
    public void ConvertsFloatCaptureFramesToPcm16()
    {
        var values = new[] { -1f, -0.5f, 0f, 0.5f, 1f, float.NaN };
        var bytes = new byte[values.Length * sizeof(float)];
        Buffer.BlockCopy(values, 0, bytes, 0, bytes.Length);

        var pcm = WindowsAudioCaptureService.ConvertFloat32ToPcm16(bytes);
        var samples = new short[values.Length];
        Buffer.BlockCopy(pcm, 0, samples, 0, pcm.Length);

        Assert.Equal([short.MinValue, -16384, 0, 16384, short.MaxValue, 0], samples);
    }
}
