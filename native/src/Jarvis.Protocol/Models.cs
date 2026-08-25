using System.Text.Json;
using System.Text.Json.Serialization;

namespace Jarvis.Protocol;

public static class ProtocolConstants
{
    public const string Version = "1.0.0";
    public const int EventSchemaVersion = 1;
    public const int MaximumEventBytes = 256 * 1024;
}

[JsonConverter(typeof(JsonStringEnumConverter<JarvisState>))]
public enum JarvisState
{
    IDLE,
    LISTENING,
    USER_SPEAKING,
    THINKING,
    SEARCHING,
    RESEARCHING,
    CODING,
    TESTING,
    WAITING_APPROVAL,
    SPEAKING,
    ERROR,
}

[JsonConverter(typeof(JsonStringEnumConverter<CodingTaskState>))]
public enum CodingTaskState
{
    QUEUED,
    PREPARING,
    INSPECTING,
    PLANNING,
    EDITING,
    TESTING,
    READY_FOR_REVIEW,
    WAITING_APPROVAL,
    COMMITTING,
    PUSHING,
    DEPLOYING,
    COMPLETED,
    FAILED,
    CANCELLED,
    BLOCKED,
}

public sealed record JarvisEvent(
    Guid Id,
    long Sequence,
    DateTimeOffset Timestamp,
    string Type,
    string Source,
    JsonElement Payload,
    int SchemaVersion = ProtocolConstants.EventSchemaVersion,
    string? SessionId = null,
    string? CorrelationId = null,
    string? CausationId = null,
    string? TaskId = null,
    string? ProjectId = null);

public sealed record CodingTask(
    string Id,
    string ProjectId,
    string Title,
    string Instruction,
    string WorkingDirectory,
    CodingTaskState State,
    string Provider,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    string? ThreadId = null,
    string? TurnId = null,
    string? Error = null);

public sealed record ProjectRecord(
    string Id,
    string Name,
    string Path,
    bool Enabled,
    bool IsGit,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record ConversationMessage(
    string Id,
    string Role,
    string Content,
    DateTimeOffset Timestamp,
    bool Streaming = false);

public sealed record CodexActivity(
    string TaskId,
    string ProjectId,
    string Kind,
    string Label,
    DateTimeOffset Timestamp,
    string? State = null,
    string? Detail = null);

public sealed record TerminalChunk(
    string SessionId,
    string Stream,
    string Content,
    DateTimeOffset Timestamp);

public sealed record AudioFrame(
    ReadOnlyMemory<byte> Pcm16,
    int SampleRate,
    int Channels,
    float Rms,
    DateTimeOffset Timestamp);

public static class JarvisJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DictionaryKeyPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter() },
    };

    public static JsonElement Element<T>(T value) =>
        JsonSerializer.SerializeToElement(value, Options);
}
