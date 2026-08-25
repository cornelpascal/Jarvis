using System.Runtime.CompilerServices;
using Jarvis.Protocol;

namespace Jarvis.Core;

public sealed class InMemoryEventStore : IJarvisEventStore
{
    private readonly List<JarvisEvent> _events = [];
    private readonly Lock _sync = new();

    public ValueTask<long> LatestSequenceAsync(CancellationToken cancellationToken = default)
    {
        lock (_sync)
        {
            return ValueTask.FromResult(_events.Count == 0 ? -1L : _events[^1].Sequence);
        }
    }

    public ValueTask AppendAsync(JarvisEvent value, CancellationToken cancellationToken = default)
    {
        lock (_sync)
        {
            _events.Add(value);
        }
        return ValueTask.CompletedTask;
    }

    public async IAsyncEnumerable<JarvisEvent> ReadAfterAsync(long sequence, int limit, [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        JarvisEvent[] snapshot;
        lock (_sync)
        {
            snapshot = _events.Where(value => value.Sequence > sequence).Take(limit).ToArray();
        }
        foreach (var value in snapshot)
        {
            cancellationToken.ThrowIfCancellationRequested();
            yield return value;
            await Task.Yield();
        }
    }
}
