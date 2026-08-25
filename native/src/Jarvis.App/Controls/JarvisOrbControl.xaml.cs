using System.Numerics;
using Jarvis.Protocol;
using Microsoft.Graphics.Canvas.UI.Xaml;
using Microsoft.UI.Composition;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.UI;
using Windows.UI.ViewManagement;

namespace Jarvis.App.Controls;

public sealed partial class JarvisOrbControl : UserControl
{
    private readonly DispatcherTimer _drawTimer = new() { Interval = TimeSpan.FromMilliseconds(33) };
    private readonly bool _animationsEnabled = new UISettings().AnimationsEnabled;
    private float _phase;
    private float _smoothedLevel;

    public static readonly DependencyProperty StateProperty = DependencyProperty.Register(
        nameof(State), typeof(JarvisState), typeof(JarvisOrbControl),
        new PropertyMetadata(JarvisState.IDLE, StateChanged));

    public static readonly DependencyProperty AudioLevelProperty = DependencyProperty.Register(
        nameof(AudioLevel), typeof(double), typeof(JarvisOrbControl),
        new PropertyMetadata(0d, AudioLevelChanged));

    public JarvisState State
    {
        get => (JarvisState)GetValue(StateProperty);
        set => SetValue(StateProperty, value);
    }

    public double AudioLevel
    {
        get => (double)GetValue(AudioLevelProperty);
        set => SetValue(AudioLevelProperty, value);
    }

    public JarvisOrbControl()
    {
        InitializeComponent();
        Loaded += LoadedControl;
        Unloaded += UnloadedControl;
        _drawTimer.Tick += (_, _) =>
        {
            _phase += 0.04f;
            SpectrumCanvas.Invalidate();
        };
    }

    private void LoadedControl(object sender, RoutedEventArgs args)
    {
        if (_animationsEnabled)
        {
            StartRotation(OuterReticle, 70, reverse: false);
            StartRotation(RingOne, 10, reverse: false);
            StartRotation(RingTwo, 7, reverse: true);
            StartRotation(RingThree, 14, reverse: false);
        }
        _drawTimer.Start();
    }

    private void UnloadedControl(object sender, RoutedEventArgs args) => _drawTimer.Stop();

    private static void StartRotation(UIElement element, double seconds, bool reverse)
    {
        var compositor = Microsoft.UI.Xaml.Media.CompositionTarget.GetCompositorForCurrentThread();
        var animation = compositor.CreateScalarKeyFrameAnimation();
        animation.InsertKeyFrame(0, reverse ? 360 : 0);
        animation.InsertKeyFrame(1, reverse ? 0 : 360);
        animation.Duration = TimeSpan.FromSeconds(seconds);
        animation.IterationBehavior = AnimationIterationBehavior.Forever;
        animation.Target = "Rotation";
        element.CenterPoint = new Vector3((float)(element.ActualSize.X / 2), (float)(element.ActualSize.Y / 2), 0);
        element.StartAnimation(animation);
    }

    private static void StateChanged(DependencyObject dependency, DependencyPropertyChangedEventArgs args) =>
        ((JarvisOrbControl)dependency).ApplyState((JarvisState)args.NewValue);

    private static void AudioLevelChanged(DependencyObject dependency, DependencyPropertyChangedEventArgs args)
    {
        var control = (JarvisOrbControl)dependency;
        var target = (float)Math.Clamp((double)args.NewValue * 8, 0, 1);
        control._smoothedLevel += (target - control._smoothedLevel) * 0.3f;
    }

    private void ApplyState(JarvisState state)
    {
        var color = state == JarvisState.ERROR ? Color.FromArgb(255, 255, 102, 123) : Color.FromArgb(255, 69, 220, 255);
        Core.BorderBrush = new Microsoft.UI.Xaml.Media.SolidColorBrush(color);
        RingOne.Stroke = new Microsoft.UI.Xaml.Media.SolidColorBrush(color);
        var active = state is JarvisState.LISTENING or JarvisState.USER_SPEAKING or JarvisState.SPEAKING;
        OrbGlow.Opacity = active ? 1 : 0.86;
        if (!_animationsEnabled)
        {
            return;
        }
        var compositor = Microsoft.UI.Xaml.Media.CompositionTarget.GetCompositorForCurrentThread();
        var scale = compositor.CreateVector3KeyFrameAnimation();
        var amount = state == JarvisState.USER_SPEAKING ? 1.06f : active ? 1.025f : 1f;
        scale.InsertKeyFrame(0, Vector3.One);
        scale.InsertKeyFrame(0.5f, new Vector3(amount));
        scale.InsertKeyFrame(1, Vector3.One);
        scale.Duration = TimeSpan.FromMilliseconds(state == JarvisState.USER_SPEAKING ? 900 : 1_400);
        scale.IterationBehavior = active ? AnimationIterationBehavior.Forever : AnimationIterationBehavior.Count;
        scale.Target = "Scale";
        OrbGlow.CenterPoint = new Vector3(71, 71, 0);
        OrbGlow.StartAnimation(scale);
    }

    private void SpectrumCanvasDraw(CanvasControl sender, CanvasDrawEventArgs args)
    {
        var center = new Vector2((float)sender.ActualWidth / 2, (float)sender.ActualHeight / 2);
        var cyan = State == JarvisState.ERROR
            ? Color.FromArgb(150, 255, 102, 123)
            : Color.FromArgb(140, 69, 220, 255);
        for (var index = 0; index < 72; index++)
        {
            var angle = index * MathF.Tau / 72;
            var wave = MathF.Sin(_phase * 3 + index * 0.43f) * _smoothedLevel * 14;
            var inner = 104 + wave;
            var outer = inner + (index % 6 == 0 ? 10 : 4);
            var from = center + new Vector2(MathF.Cos(angle), MathF.Sin(angle)) * inner;
            var to = center + new Vector2(MathF.Cos(angle), MathF.Sin(angle)) * outer;
            args.DrawingSession.DrawLine(from, to, cyan, index % 6 == 0 ? 1.4f : 0.65f);
        }
        args.DrawingSession.DrawCircle(center, 112 + _smoothedLevel * 5, Color.FromArgb(45, 69, 220, 255), 1);
    }
}
