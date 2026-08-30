using Jarvis.App.ViewModels;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Windows.System;

namespace Jarvis.App;

public sealed partial class MainPage : Page, IDisposable
{
    public MainViewModel ViewModel { get; } = new();

    public MainPage()
    {
        InitializeComponent();
        DataContext = ViewModel;
        Loaded += async (_, _) => await ViewModel.InitializeAsync();
    }

    private async void ExecuteClicked(object sender, RoutedEventArgs e) => await ViewModel.SubmitAsync();
    private async void VoiceClicked(object sender, RoutedEventArgs e) => await ViewModel.ToggleVoiceAsync();
    private async void EnrollClicked(object sender, RoutedEventArgs e) => await ViewModel.EnrollWakeWordAsync();
    private async void OrbTapped(object sender, TappedRoutedEventArgs e) => await ViewModel.ToggleVoiceAsync();
    private async void RunShellClicked(object sender, RoutedEventArgs e) => await ViewModel.RunShellCommandAsync();
    private async void StopClicked(object sender, RoutedEventArgs e) => await ViewModel.InterruptAsync();

    public Task ActivateVoiceAsync() => ViewModel.ToggleVoiceAsync();

    private async void PromptKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key == VirtualKey.Enter && !Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(VirtualKey.Shift).HasFlag(Windows.UI.Core.CoreVirtualKeyStates.Down))
        {
            e.Handled = true;
            await ViewModel.SubmitAsync();
        }
    }

    private async void ShellKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key == VirtualKey.Enter)
        {
            e.Handled = true;
            await ViewModel.RunShellCommandAsync();
        }
    }

    public void Dispose() => ViewModel.DisposeAsync().AsTask().GetAwaiter().GetResult();
}
