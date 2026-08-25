using CommunityToolkit.Mvvm.ComponentModel;

namespace Jarvis.App.ViewModels;

public sealed partial class MessageItemViewModel : ObservableObject
{
    private string _content = string.Empty;
    public MessageItemViewModel(string id, string role, string content)
    {
        Id = id;
        Role = role;
        Content = content;
    }
    public string Id { get; }
    public string Role { get; }
    public string Label => Role == "assistant" ? "JARVIS / CODEX" : Role.ToUpperInvariant();
    public string Content
    {
        get => _content;
        set => SetProperty(ref _content, value);
    }
}

public sealed record ActivityItemViewModel(string Label, string Detail, DateTimeOffset Timestamp);
public sealed record ProjectItemViewModel(string Id, string Name, string Path);

public sealed partial class TaskItemViewModel : ObservableObject
{
    private string _state = string.Empty;
    public TaskItemViewModel(string id, string title, string state)
    {
        Id = id;
        Title = title;
        State = state;
    }
    public string Id { get; }
    public string Title { get; }
    public string State
    {
        get => _state;
        set => SetProperty(ref _state, value);
    }
}
