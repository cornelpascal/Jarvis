using Jarvis.Core;

namespace Jarvis.Tests;

public sealed class EventBusTests
{
    [Fact]
    public async Task PublishesDurablyAndReplaysInSequence()
    {
        var store = new InMemoryEventStore();
        await using var bus = await JarvisEventBus.CreateAsync(store);
        var first = await bus.PublishAsync("jarvis.test", "tests", new { message = "one", ordinal = 1 });
        var second = await bus.PublishAsync("jarvis.test", "tests", new { message = "two", ordinal = 2 });

        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        var replayed = new List<long>();
        await foreach (var value in bus.SubscribeAsync(-1, timeout.Token))
        {
            replayed.Add(value.Sequence);
            if (replayed.Count == 2)
            {
                break;
            }
        }

        Assert.Equal(first.Sequence + 1, second.Sequence);
        Assert.Equal([first.Sequence, second.Sequence], replayed);
    }
}
