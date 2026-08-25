using Microsoft.UI.Xaml;
using Jarvis.Infrastructure;

namespace Jarvis.App;

public partial class App : Application
{
    private MainWindow? _window;
    private readonly SingleInstanceCoordinator _singleInstance;

    public App()
    {
        _singleInstance = SingleInstanceCoordinator.Create();
        InitializeComponent();
        UnhandledException += (_, args) =>
        {
            JarvisLog.Write("fatal", "app.unhandled", args.Exception.Message, args.Exception);
            System.Diagnostics.Debug.WriteLine(args.Exception);
        };
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        if (!_singleInstance.IsPrimary)
        {
            _singleInstance.SignalPrimary();
            Environment.Exit(0);
            return;
        }
        _window = new MainWindow();
        _window.Activate();
        _ = _singleInstance.ListenAsync(
            Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread(),
            () => _window?.BringToFront());
        _window.Closed += (_, _) => _singleInstance.Dispose();
    }
}
