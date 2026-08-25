using Jarvis.Core;
using Jarvis.Infrastructure;

namespace Jarvis.Tests;

public sealed class SqliteEventStoreTests
{
    [Fact]
    public async Task ReopensAndContinuesExistingSequence()
    {
        var directory = Path.Combine(Path.GetTempPath(), "jarvis-native-tests", Guid.NewGuid().ToString());
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, "jarvis.sqlite");
        try
        {
            await using (var store = await SqliteEventStore.OpenAsync(path))
            await using (var bus = await JarvisEventBus.CreateAsync(store))
            {
                await bus.PublishAsync("jarvis.test", "tests", new { message = "persisted", ordinal = 0 });
            }
            await using (var reopened = await SqliteEventStore.OpenAsync(path))
            {
                Assert.Equal(0, await reopened.LatestSequenceAsync());
            }
        }
        finally
        {
            if (Directory.Exists(directory))
            {
                Directory.Delete(directory, recursive: true);
            }
        }
    }
}
