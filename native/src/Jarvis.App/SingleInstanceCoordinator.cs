using Microsoft.UI.Dispatching;

namespace Jarvis.App;

internal sealed class SingleInstanceCoordinator : IDisposable
{
    private const string MutexName = "Local\\Jarvis.Native.WinUI.Instance";
    private const string ActivationEventName = "Local\\Jarvis.Native.WinUI.Activate";
    private readonly Mutex _mutex;
    private readonly EventWaitHandle _activationEvent;
    private readonly CancellationTokenSource _lifetime = new();
    private bool _ownsMutex;

    private SingleInstanceCoordinator(Mutex mutex, EventWaitHandle activationEvent, bool ownsMutex)
    {
        _mutex = mutex;
        _activationEvent = activationEvent;
        _ownsMutex = ownsMutex;
    }

    public bool IsPrimary => _ownsMutex;

    public static SingleInstanceCoordinator Create()
    {
        var mutex = new Mutex(initiallyOwned: true, MutexName, out var createdNew);
        var activationEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ActivationEventName);
        return new SingleInstanceCoordinator(mutex, activationEvent, createdNew);
    }

    public void SignalPrimary() => _activationEvent.Set();

    public Task ListenAsync(DispatcherQueue dispatcher, Action activate)
    {
        return Task.Run(() =>
        {
            var handles = new WaitHandle[] { _activationEvent, _lifetime.Token.WaitHandle };
            while (WaitHandle.WaitAny(handles) == 0)
            {
                dispatcher.TryEnqueue(() => activate());
            }
        });
    }

    public void Dispose()
    {
        _lifetime.Cancel();
        _activationEvent.Dispose();
        _lifetime.Dispose();
        if (_ownsMutex)
        {
            _mutex.ReleaseMutex();
            _ownsMutex = false;
        }
        _mutex.Dispose();
    }
}
