using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using System.Threading.Channels;
using Jarvis.Protocol;

namespace Jarvis.Core;

public sealed class JarvisEventBus : IJarvisEventBus, IAsyncDisposable
{
    private readonly IJarvisEventStore _store;
    private readonly ConcurrentDictionary<Guid, Channel<JarvisEvent>> _subscribers = new();
    private long _sequence;

    private JarvisEventBus(IJarvisEventStore store, long latestSequence)
    {
        _store = store;
        _sequence = latestSequence;
    }

    public static async Task<JarvisEventBus> CreateAsync(IJarvisEventStore store, CancellationToken cancellationToken = default) =>
        new(store, await store.LatestSequenceAsync(cancellationToken));

    public async ValueTask<JarvisEvent> PublishAsync<T>(
        string type,
        string source,
        T payload,
        string? taskId = null,
        string? projectId = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(type);
        ArgumentException.ThrowIfNullOrWhiteSpace(source);
        var value = new JarvisEvent(
            Guid.NewGuid(),
            Interlocked.Increment(ref _sequence),
            DateTimeOffset.UtcNow,
            type,
            source,
            JarvisJson.Element(payload),
            TaskId: taskId,
            ProjectId: projectId);
        await _store.AppendAsync(value, cancellationToken);
        foreach (var channel in _subscribers.Values)
        {
            channel.Writer.TryWrite(value);
        }

        return value;
    }

    public async IAsyncEnumerable<JarvisEvent> SubscribeAsync(
        long afterSequence = -1,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await foreach (var replayed in _store.ReadAfterAsync(afterSequence, 500, cancellationToken))
        {
            yield return replayed;
            afterSequence = replayed.Sequence;
        }

        var id = Guid.NewGuid();
        var channel = Channel.CreateBounded<JarvisEvent>(new BoundedChannelOptions(512)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
            SingleWriter = false,
        });
        _subscribers[id] = channel;
        try
        {
            await foreach (var value in channel.Reader.ReadAllAsync(cancellationToken))
            {
                if (value.Sequence > afterSequence)
                {
                    yield return value;
                }
            }
        }
        finally
        {
            _subscribers.TryRemove(id, out _);
        }
    }

    public ValueTask DisposeAsync()
    {
        foreach (var channel in _subscribers.Values)
        {
            channel.Writer.TryComplete();
        }
        _subscribers.Clear();
        return ValueTask.CompletedTask;
    }
}
