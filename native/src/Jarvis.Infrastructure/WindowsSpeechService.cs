using Windows.Media.Core;
using Windows.Media.Playback;
using Windows.Media.SpeechSynthesis;

namespace Jarvis.Infrastructure;

public sealed class WindowsSpeechService : IAsyncDisposable
{
    private readonly SpeechSynthesizer _synthesizer = new();
    private readonly MediaPlayer _player = new() { AutoPlay = false };
    private readonly SemaphoreSlim _gate = new(1, 1);

    public async Task SpeakAsync(string text, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(text)) return;
        await _gate.WaitAsync(cancellationToken);
        try
        {
            using var stream = await _synthesizer.SynthesizeTextToStreamAsync(text);
            using var source = MediaSource.CreateFromStream(stream, stream.ContentType);
            var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            void Ended(MediaPlayer sender, object args) => completion.TrySetResult();
            void Failed(MediaPlayer sender, MediaPlayerFailedEventArgs args) => completion.TrySetException(new InvalidOperationException(args.ErrorMessage));
            _player.MediaEnded += Ended;
            _player.MediaFailed += Failed;
            try
            {
                _player.Source = source;
                _player.Play();
                await completion.Task.WaitAsync(cancellationToken);
            }
            finally
            {
                _player.Pause();
                _player.Source = null;
                _player.MediaEnded -= Ended;
                _player.MediaFailed -= Failed;
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    public ValueTask DisposeAsync()
    {
        _player.Dispose();
        _synthesizer.Dispose();
        _gate.Dispose();
        return ValueTask.CompletedTask;
    }
}
