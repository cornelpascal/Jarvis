using System.Collections.ObjectModel;
using System.Text.Json;
using CommunityToolkit.Mvvm.ComponentModel;
using Jarvis.Core;
using Jarvis.Infrastructure;
using Jarvis.Protocol;
using Microsoft.UI.Dispatching;

namespace Jarvis.App.ViewModels;

public sealed partial class MainViewModel : ObservableObject, IAsyncDisposable
{
    private string _prompt = string.Empty;
    private string _shellCommand = string.Empty;
    private string _terminalText = string.Empty;
    private string _diff = string.Empty;
    private string _liveTranscript = "Voice standby";
    private string _status = "NATIVE CORE STARTING";
    private string _connectionStatus = "CODEX LINK · STANDBY";
    private string _clock = DateTime.Now.ToString("HH:mm:ss");
    private JarvisState _state = JarvisState.IDLE;
    private double _audioLevel;
    private string _audioLevelText = "MIC · 0.000";
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private readonly CancellationTokenSource _lifetime = new();
    private JarvisConfiguration? _configuration;
    private SqliteEventStore? _store;
    private ProjectRegistryService? _projectRegistry;
    private TaskPersistenceService? _taskStore;
    private JarvisEventBus? _eventBus;
    private CodexSessionService? _codex;
    private ITerminalSession? _terminal;
    private WindowsAudioCaptureService? _audio;
    private SonioxTranscriptionSession? _transcription;
    private OnnxWakeWordDetector? _wakeWord;
    private CancellationTokenSource? _voiceLifetime;
    private string? _threadId;
    private string? _turnId;
    private string? _activeTaskId;
    private bool _turnActive;
    private bool _voiceInitiatedTurn;
    private bool _initialized;
    private string? _voiceStartupError;
    private readonly AnsiTerminalBuffer _terminalBuffer = new(160_000);
    private readonly WindowsSpeechService _speech = new();

    public string Prompt { get => _prompt; set => SetProperty(ref _prompt, value); }
    public string ShellCommand { get => _shellCommand; set => SetProperty(ref _shellCommand, value); }
    public string TerminalText { get => _terminalText; set => SetProperty(ref _terminalText, value); }
    public string Diff { get => _diff; set => SetProperty(ref _diff, value); }
    public string LiveTranscript { get => _liveTranscript; set => SetProperty(ref _liveTranscript, value); }
    public string Status { get => _status; set => SetProperty(ref _status, value); }
    public string ConnectionStatus { get => _connectionStatus; set => SetProperty(ref _connectionStatus, value); }
    public string Clock { get => _clock; set => SetProperty(ref _clock, value); }
    public JarvisState State { get => _state; set => SetProperty(ref _state, value); }
    public double AudioLevel { get => _audioLevel; set => SetProperty(ref _audioLevel, value); }
    public string AudioLevelText { get => _audioLevelText; set => SetProperty(ref _audioLevelText, value); }

    public ObservableCollection<MessageItemViewModel> Messages { get; } = [];
    public ObservableCollection<ActivityItemViewModel> Activities { get; } = [];
    public ObservableCollection<ProjectItemViewModel> Projects { get; } = [];
    public ObservableCollection<TaskItemViewModel> Tasks { get; } = [];

    public async Task InitializeAsync()
    {
        if (_initialized)
        {
            return;
        }
        _initialized = true;
        try
        {
            _configuration = JarvisConfiguration.Load();
            Directory.CreateDirectory(_configuration.DataDirectory);
            _store = await SqliteEventStore.OpenAsync(_configuration.DatabasePath, _lifetime.Token);
            _projectRegistry = await ProjectRegistryService.OpenAsync(_configuration.DatabasePath, _lifetime.Token);
            _taskStore = await TaskPersistenceService.OpenAsync(_configuration.DatabasePath, _lifetime.Token);
            var registered = await _projectRegistry.SynchronizeAsync(_configuration.ProjectRoots, _lifetime.Token);
            foreach (var project in registered.Where(value => value.Enabled))
            {
                Projects.Add(new ProjectItemViewModel(project.Id, project.Name, project.Path));
            }
            if (Projects.Count == 0)
            {
                var workspace = Path.Combine(_configuration.DataDirectory, "workspace");
                Directory.CreateDirectory(workspace);
                var project = await _projectRegistry.RegisterAsync(workspace, _lifetime.Token);
                Projects.Add(new ProjectItemViewModel(project.Id, project.Name, project.Path));
            }
            foreach (var task in await _taskStore.ListAsync(cancellationToken: _lifetime.Token))
            {
                Tasks.Add(new TaskItemViewModel(task.Id, task.Title, task.State.ToString()));
            }
            _eventBus = await JarvisEventBus.CreateAsync(_store, _lifetime.Token);
            var codexClient = new CodexJsonRpcClient(_configuration.CodexExecutable);
            var skills = ResolveSkillPaths();
            _codex = new CodexSessionService(codexClient, _eventBus, skills);
            _ = ConsumeEventsAsync(_lifetime.Token);
            _ = TickClockAsync(_lifetime.Token);
            if (_configuration.VoiceEnabled && _configuration.WakeWordEnabled)
            {
                try
                {
                    _audio = new WindowsAudioCaptureService();
                    await _audio.StartAsync(_lifetime.Token);
                    var modelDirectory = Path.Combine(AppContext.BaseDirectory, "Assets", "WakeWord");
                    var profilePath = Path.Combine(_configuration.DataDirectory, "voice", "jarvis-wake-profile.json");
                    _wakeWord = new OnnxWakeWordDetector(
                        modelDirectory,
                        _configuration.WakeWordThreshold,
                        _configuration.WakeWordCooldownMilliseconds,
                        profilePath,
                        _configuration.WakeWordProfileThreshold);
                    _wakeWord.EnrollmentProgress += WakeWordEnrollmentProgress;
                    await _wakeWord.StartAsync(_audio.Frames(_lifetime.Token), _lifetime.Token);
                    _ = MonitorAudioAsync(_audio.Frames(_lifetime.Token), _lifetime.Token);
                    _ = ConsumeWakeWordAsync(_wakeWord, _lifetime.Token);
                    LiveTranscript = _wakeWord.IsEnrolled
                        ? "Personal Hey Jarvis trigger ready"
                        : "Enroll your Hey Jarvis trigger to enable hands-free voice";
                }
                catch (Exception error)
                {
                    JarvisLog.Write("error", "voice.wake", error.Message, error);
                    _voiceStartupError = error.Message;
                    LiveTranscript = "Voice unavailable · no active microphone";
                    _wakeWord = null;
                    if (_audio is not null) await _audio.StopAsync();
                }
            }
            Messages.Add(new MessageItemViewModel(Guid.NewGuid().ToString(), "assistant",
                "**Interface online.** Type a directive or activate native voice input."));
            Status = _voiceStartupError is null
                ? "NATIVE CORE ONLINE · CODEX READY ON DEMAND"
                : $"NATIVE CORE ONLINE · VOICE UNAVAILABLE · {_voiceStartupError}";
        }
        catch (Exception error)
        {
            JarvisLog.Write("error", "app.initialize", error.Message, error);
            State = JarvisState.ERROR;
            Status = error.Message;
        }
    }

    public async Task SubmitAsync()
    {
        var instruction = Prompt.Trim();
        if (instruction.Length == 0 || _configuration is null || _codex is null)
        {
            return;
        }
        Prompt = string.Empty;
        Messages.Add(new MessageItemViewModel(Guid.NewGuid().ToString(), "user", instruction));
        State = JarvisState.THINKING;
        ConnectionStatus = "CODEX LINK · ACTIVE";
        try
        {
            var workspace = Projects[0].Path;
            if (_threadId is null)
            {
                _activeTaskId = Guid.NewGuid().ToString();
                var title = instruction.Length > 72 ? instruction[..72] : instruction;
                Tasks.Insert(0, new TaskItemViewModel(_activeTaskId, title, CodingTaskState.PREPARING.ToString()));
                var now = DateTimeOffset.UtcNow;
                await _taskStore!.CreateAsync(new CodingTask(_activeTaskId, Projects[0].Id, title, instruction, workspace,
                    CodingTaskState.PREPARING, "codex", now, now), _lifetime.Token);
                var started = await _codex.StartAsync(_activeTaskId, Projects[0].Id, workspace, instruction, _lifetime.Token);
                _threadId = started.ThreadId;
                _turnId = started.TurnId;
                _turnActive = true;
                await _taskStore.UpdateAsync(_activeTaskId, CodingTaskState.EDITING, _threadId, _turnId, cancellationToken: _lifetime.Token);
            }
            else if (_turnActive && _turnId is not null)
            {
                await _codex.SteerAsync(_threadId, _turnId, instruction, _lifetime.Token);
            }
            else
            {
                _turnId = await _codex.StartTurnAsync(_threadId, workspace, instruction, _lifetime.Token);
                _turnActive = true;
            }
        }
        catch (Exception error)
        {
            JarvisLog.Write("error", "codex.turn", error.Message, error);
            State = JarvisState.ERROR;
            Status = error.Message;
            Messages.Add(new MessageItemViewModel(Guid.NewGuid().ToString(), "activity", $"Codex error: {error.Message}"));
            if (_activeTaskId is not null && _taskStore is not null)
            {
                await _taskStore.UpdateAsync(_activeTaskId, CodingTaskState.FAILED, error: error.Message, cancellationToken: _lifetime.Token);
            }
        }
    }

    public async Task RunShellCommandAsync()
    {
        var command = ShellCommand.Trim();
        if (command.Length == 0)
        {
            return;
        }
        ShellCommand = string.Empty;
        if (_terminal is { IsRunning: true })
        {
            await _terminal.WriteAsync(command + Environment.NewLine, _lifetime.Token);
            return;
        }
        var conPty = new ConPtyTerminalSession();
        await conPty.StartAsync("powershell.exe", ["-NoLogo", "-NoProfile"], Projects[0].Path, cancellationToken: _lifetime.Token);
        await Task.Delay(150, _lifetime.Token);
        if (conPty.IsRunning)
        {
            _terminal = conPty;
        }
        else
        {
            await conPty.DisposeAsync();
            _terminal = new ProcessTerminalSession();
            await _terminal.StartAsync("powershell.exe", ["-NoLogo", "-NoProfile"], Projects[0].Path, cancellationToken: _lifetime.Token);
            Activities.Insert(0, new ActivityItemViewModel("terminal/fallback", "ConPTY shell exited during startup; using redirected native process transport.", DateTimeOffset.UtcNow));
        }
        _ = ConsumeTerminalAsync(_terminal, _lifetime.Token);
        await _terminal.WriteAsync(command + Environment.NewLine, _lifetime.Token);
    }

    public async Task InterruptAsync()
    {
        if (_codex is null || _threadId is null || _turnId is null || !_turnActive) return;
        await _codex.InterruptAsync(_threadId, _turnId, _lifetime.Token);
        _turnActive = false;
        State = JarvisState.IDLE;
        Status = "CODEX TURN INTERRUPTED";
        if (_activeTaskId is not null && _taskStore is not null)
        {
            await _taskStore.UpdateAsync(_activeTaskId, CodingTaskState.CANCELLED, cancellationToken: _lifetime.Token);
        }
    }

    public async Task ToggleVoiceAsync()
    {
        if (_voiceLifetime is not null)
        {
            await StopVoiceAsync();
            return;
        }
        if (_configuration?.SonioxApiKey is not { Length: > 0 } apiKey)
        {
            State = JarvisState.ERROR;
            LiveTranscript = "Hey Jarvis detected · ASR provider is not configured";
            Status = "VOICE UNAVAILABLE · SONIOX_API_KEY IS NOT CONFIGURED";
            JarvisLog.Write("warning", "voice.activation", "Wake word detected, but SONIOX_API_KEY is not configured.");
            return;
        }
        _voiceLifetime = CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token);
        try
        {
            _audio ??= new WindowsAudioCaptureService();
            await _audio.StartAsync(_voiceLifetime.Token);
            _transcription = new SonioxTranscriptionSession(apiKey, _configuration.SonioxTranscriptionModel);
            await _transcription.StartAsync(_audio.Frames(_voiceLifetime.Token), _voiceLifetime.Token);
            _ = ConsumeTranscriptionAsync(_transcription, _voiceLifetime.Token);
            State = JarvisState.LISTENING;
            LiveTranscript = "Listening…";
            Status = "VOICE LISTENING · ONE SECOND SILENCE ENDS THE TURN";
        }
        catch (Exception error) when (error is not OperationCanceledException || !_lifetime.IsCancellationRequested)
        {
            JarvisLog.Write("error", "voice.realtime", error.Message, error);
            await StopVoiceAsync();
            State = JarvisState.ERROR;
            Status = $"VOICE ERROR · {FriendlyVoiceError(error.Message)}";
        }
    }

    public async Task EnrollWakeWordAsync()
    {
        if (_wakeWord is null)
        {
            State = JarvisState.ERROR;
            Status = "WAKE ENROLLMENT UNAVAILABLE · MICROPHONE OR MODEL IS NOT READY";
            return;
        }
        await _wakeWord.BeginEnrollmentAsync(cancellationToken: _lifetime.Token);
        State = JarvisState.LISTENING;
        LiveTranscript = "Say “Hey Jarvis” naturally · sample 1 of 8";
        Status = "PERSONAL WAKE ENROLLMENT · PAUSE BETWEEN SAMPLES";
    }

    private void WakeWordEnrollmentProgress(object? sender, WakeWordEnrollmentProgress progress)
    {
        _dispatcher.TryEnqueue(() =>
        {
            if (progress.IsComplete)
            {
                State = JarvisState.IDLE;
                LiveTranscript = "Personal Hey Jarvis trigger ready";
                Status = "PERSONAL WAKE PROFILE SAVED · LISTENING LOCALLY";
                return;
            }
            var next = Math.Min(progress.CollectedSamples + 1, progress.RequiredSamples);
            LiveTranscript = $"Say “Hey Jarvis” naturally · sample {next} of {progress.RequiredSamples}";
            Status = $"PERSONAL WAKE ENROLLMENT · {progress.CollectedSamples}/{progress.RequiredSamples} CAPTURED";
        });
    }

    private async Task StopVoiceAsync()
    {
        var lifetime = _voiceLifetime;
        _voiceLifetime = null;
        lifetime?.Cancel();
        if (_transcription is not null)
        {
            var transcription = _transcription;
            _transcription = null;
            try
            {
                await transcription.DisposeAsync();
            }
            catch (Exception error)
            {
                JarvisLog.Write("warning", "voice.stop", error.Message, error);
            }
        }
        if (_audio is not null && _wakeWord is null)
        {
            await _audio.StopAsync();
        }
        lifetime?.Dispose();
        AudioLevel = 0;
        State = JarvisState.IDLE;
        Status = "VOICE STANDBY";
    }

    private async Task MonitorAudioAsync(IAsyncEnumerable<AudioFrame> frames, CancellationToken cancellationToken)
    {
        await foreach (var frame in frames.WithCancellation(cancellationToken))
        {
            _dispatcher.TryEnqueue(() =>
            {
                AudioLevel = frame.Rms;
                AudioLevelText = $"MIC · {frame.Rms:0.000}";
            });
        }
    }

    private async Task ConsumeTranscriptionAsync(IRealtimeTranscriptionSession session, CancellationToken cancellationToken)
    {
        await foreach (var value in session.Events(cancellationToken))
        {
            _dispatcher.TryEnqueue(async () =>
            {
                switch (value.Type)
                {
                    case "speech_started":
                        State = JarvisState.USER_SPEAKING;
                        LiveTranscript = string.Empty;
                        break;
                    case "speech_stopped":
                        State = JarvisState.THINKING;
                        break;
                    case "transcript_delta" when value.Transcript is { Length: > 0 } delta:
                        LiveTranscript = delta;
                        break;
                    case "transcript" when value.Transcript is not null:
                        LiveTranscript = value.Transcript;
                        var command = value.Transcript.Trim();
                        if (command.Length > 0)
                        {
                            _voiceInitiatedTurn = true;
                            Prompt = command;
                            await SubmitAsync();
                        }
                        else
                        {
                            State = JarvisState.LISTENING;
                            Status = "VOICE IGNORED · EMPTY TRANSCRIPT";
                        }
                        break;
                    case "error":
                        var error = FriendlyVoiceError(value.Error);
                        JarvisLog.Write("error", "voice.realtime", error);
                        await StopVoiceAsync();
                        State = JarvisState.ERROR;
                        Status = $"VOICE ERROR · {error}";
                        break;
                }
            });
        }
    }

    private static string FriendlyVoiceError(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "REALTIME SESSION FAILED";
        try
        {
            using var document = JsonDocument.Parse(value);
            var root = document.RootElement;
            if (root.TryGetProperty("error", out var error)) root = error;
            if (root.TryGetProperty("message", out var message) && message.GetString() is { Length: > 0 } text)
            {
                return text;
            }
        }
        catch (JsonException)
        {
        }
        return value.Length <= 240 ? value : $"{value[..237]}...";
    }

    private async Task ConsumeWakeWordAsync(IWakeWordDetector detector, CancellationToken cancellationToken)
    {
        await foreach (var detection in detector.Detections(cancellationToken))
        {
            _dispatcher.TryEnqueue(async () =>
            {
                if (_voiceLifetime is null && State != JarvisState.SPEAKING)
                {
                    LiveTranscript = $"Hey Jarvis detected · {detection.Score:0.00}";
                    Status = $"WAKE WORD · {detection.Score:0.00}";
                    JarvisLog.Write("info", "voice.activation", $"Wake word propagated to ASR activation with score {detection.Score:0.000}.");
                    await ToggleVoiceAsync();
                }
            });
        }
    }

    private async Task ConsumeEventsAsync(CancellationToken cancellationToken)
    {
        if (_eventBus is null)
        {
            return;
        }
        await foreach (var value in _eventBus.SubscribeAsync(-1, cancellationToken))
        {
            _dispatcher.TryEnqueue(() => ProjectEvent(value));
        }
    }

    private void ProjectEvent(JarvisEvent value)
    {
        if (value.Type == "conversation.message.delta")
        {
            var content = PropertyString(value.Payload, "content");
            if (content is null)
            {
                return;
            }
            var message = Messages.LastOrDefault(item => item.Id == value.TaskId && item.Role == "assistant");
            if (message is null)
            {
                message = new MessageItemViewModel(value.TaskId ?? Guid.NewGuid().ToString(), "assistant", string.Empty);
                Messages.Add(message);
            }
            message.Content += content;
            State = JarvisState.CODING;
            return;
        }
        if (value.Type == "codex.terminal")
        {
            var label = PropertyString(value.Payload, "label") ?? value.Type;
            var detail = PropertyString(value.Payload, "detail") ?? string.Empty;
            Activities.Insert(0, new ActivityItemViewModel(label, detail, value.Timestamp));
            while (Activities.Count > 500)
            {
                Activities.RemoveAt(Activities.Count - 1);
            }
            if (label == "turn/completed")
            {
                _turnActive = false;
                State = JarvisState.IDLE;
                ConnectionStatus = "CODEX LINK · STABLE";
                if (Tasks.FirstOrDefault(item => item.Id == _activeTaskId) is { } task)
                {
                    task.State = CodingTaskState.READY_FOR_REVIEW.ToString();
                }
                if (_activeTaskId is not null && _taskStore is not null)
                {
                    _ = _taskStore.UpdateAsync(_activeTaskId, CodingTaskState.READY_FOR_REVIEW, cancellationToken: _lifetime.Token);
                }
                if (_voiceInitiatedTurn && Messages.LastOrDefault(item => item.Role == "assistant") is { Content.Length: > 0 } answer)
                {
                    _voiceInitiatedTurn = false;
                    _ = SpeakAsync(answer.Content, _lifetime.Token);
                }
            }
            if (label == "turn/diff/updated")
            {
                Diff = detail;
            }
        }
    }

    private async Task ConsumeTerminalAsync(ITerminalSession terminal, CancellationToken cancellationToken)
    {
        await foreach (var chunk in terminal.Output(cancellationToken))
        {
            _dispatcher.TryEnqueue(() =>
            {
                _terminalBuffer.Append(chunk.Content);
                TerminalText = _terminalBuffer.Text;
            });
        }
    }

    private async Task TickClockAsync(CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));
        while (await timer.WaitForNextTickAsync(cancellationToken))
        {
            _dispatcher.TryEnqueue(() => Clock = DateTime.Now.ToString("HH:mm:ss"));
        }
    }

    private async Task SpeakAsync(string content, CancellationToken cancellationToken)
    {
        try
        {
            _wakeWord?.SetSuppressed(true);
            State = JarvisState.SPEAKING;
            // Markdown punctuation is harmless to the system synthesizer; cap
            // exceptionally long coding responses so speech remains interruptible.
            await _speech.SpeakAsync(content[..Math.Min(content.Length, 4_000)], cancellationToken);
            State = JarvisState.IDLE;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
        catch (Exception error)
        {
            State = JarvisState.ERROR;
            Status = $"SPEECH ERROR · {error.Message}";
        }
        finally
        {
            _wakeWord?.SetSuppressed(false);
        }
    }

    private static string? PropertyString(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static IReadOnlyList<string> ResolveSkillPaths()
    {
        var directory = Environment.GetEnvironmentVariable("JARVIS_SKILLS_DIR");
        return directory is { Length: > 0 } && Directory.Exists(directory)
            ? Directory.EnumerateFiles(directory, "SKILL.md", SearchOption.AllDirectories).ToArray()
            : [];
    }

    public async ValueTask DisposeAsync()
    {
        _lifetime.Cancel();
        if (_voiceLifetime is not null)
        {
            await StopVoiceAsync();
        }
        if (_terminal is not null)
        {
            await _terminal.DisposeAsync();
        }
        if (_audio is not null)
        {
            await _audio.DisposeAsync();
        }
        if (_wakeWord is not null)
        {
            _wakeWord.EnrollmentProgress -= WakeWordEnrollmentProgress;
            await _wakeWord.DisposeAsync();
        }
        if (_codex is not null)
        {
            await _codex.DisposeAsync();
        }
        if (_eventBus is not null)
        {
            await _eventBus.DisposeAsync();
        }
        if (_store is not null)
        {
            await _store.DisposeAsync();
        }
        await _speech.DisposeAsync();
        if (_projectRegistry is not null)
        {
            await _projectRegistry.DisposeAsync();
        }
        if (_taskStore is not null)
        {
            await _taskStore.DisposeAsync();
        }
        _lifetime.Dispose();
    }
}
