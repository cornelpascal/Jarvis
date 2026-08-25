using Microsoft.UI;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using System.Runtime.InteropServices;
using WinRT.Interop;

namespace Jarvis.App;

public sealed partial class MainWindow : Window
{
    private const int WindowProcedureIndex = -4;
    private const uint WindowMessageHotKey = 0x0312;
    private const uint ModifierAlt = 0x0001;
    private const uint ModifierNoRepeat = 0x4000;
    private const uint VirtualKeySpace = 0x20;
    private const int HotKeyId = 0x4A41;
    private readonly IntPtr _windowHandle;
    private readonly WindowProcedure _windowProcedure;
    private readonly IntPtr _previousWindowProcedure;

    public MainWindow()
    {
        InitializeComponent();
        ExtendsContentIntoTitleBar = true;
        _windowHandle = WindowNative.GetWindowHandle(this);
        var windowId = Win32Interop.GetWindowIdFromWindow(_windowHandle);
        var appWindow = AppWindow.GetFromWindowId(windowId);
        appWindow.SetPresenter(AppWindowPresenterKind.FullScreen);
        _windowProcedure = WindowMessage;
        _previousWindowProcedure = SetWindowLongPtr(_windowHandle, WindowProcedureIndex,
            Marshal.GetFunctionPointerForDelegate(_windowProcedure));
        _ = RegisterHotKey(_windowHandle, HotKeyId, ModifierAlt | ModifierNoRepeat, VirtualKeySpace);
        appWindow.Closing += (_, _) =>
        {
            UnregisterHotKey(_windowHandle, HotKeyId);
            (Root.Children.FirstOrDefault() as MainPage)?.Dispose();
        };
    }

    internal void BringToFront()
    {
        ShowWindow(_windowHandle, 9);
        Activate();
        _ = SetForegroundWindow(_windowHandle);
    }

    private IntPtr WindowMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam)
    {
        if (message == WindowMessageHotKey && wParam == HotKeyId)
        {
            BringToFront();
            if (Root.Children.FirstOrDefault() is MainPage page)
            {
                _ = page.ActivateVoiceAsync();
            }
            return IntPtr.Zero;
        }
        return CallWindowProc(_previousWindowProcedure, window, message, wParam, lParam);
    }

    private delegate IntPtr WindowProcedure(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
    private static extern IntPtr SetWindowLongPtr(IntPtr window, int index, IntPtr value);

    [DllImport("user32.dll")]
    private static extern IntPtr CallWindowProc(IntPtr previous, IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool RegisterHotKey(IntPtr window, int id, uint modifiers, uint virtualKey);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnregisterHotKey(IntPtr window, int id);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(IntPtr window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindow(IntPtr window, int command);
}
