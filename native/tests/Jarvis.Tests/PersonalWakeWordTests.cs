using Jarvis.Infrastructure;

namespace Jarvis.Tests;

public sealed class PersonalWakeWordTests
{
    [Fact]
    public void CosineSimilarityRecognizesMatchingAndRejectsOpposingSignatures()
    {
        var signature = new[] { 0.5f, 0.5f, 0.5f, 0.5f };

        Assert.Equal(1f, OnnxWakeWordDetector.CosineSimilarity(signature, signature), 5);
        Assert.Equal(-1f, OnnxWakeWordDetector.CosineSimilarity(signature, signature.Select(value => -value).ToArray()), 5);
    }

    [Fact]
    public void BestProfileSimilaritySelectsClosestEnrollmentSample()
    {
        var signature = new[] { 1f, 0f, 0f };
        var samples = new[]
        {
            new[] { 0f, 1f, 0f },
            new[] { 0.99f, 0.01f, 0f },
        };

        Assert.True(OnnxWakeWordDetector.BestProfileSimilarity(signature, samples) > 0.99f);
    }

    [Fact]
    public async Task ProfileStoreRoundTripsEnrollmentWithoutRawAudio()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"jarvis-wake-profile-{Guid.NewGuid():N}");
        var path = Path.Combine(directory, "profile.json");
        try
        {
            var store = new WakeWordProfileStore(path);
            await store.SaveAsync([new[] { 0.1f, 0.2f, 0.3f }]);

            var profile = await store.LoadAsync();

            Assert.NotNull(profile);
            Assert.Equal("hey jarvis", profile.Phrase);
            Assert.Equal([0.1f, 0.2f, 0.3f], profile.Samples.Single());
            Assert.DoesNotContain("pcm", await File.ReadAllTextAsync(path), StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }
    }
}
