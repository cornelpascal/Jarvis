using Jarvis.Protocol;
using Microsoft.Data.Sqlite;

namespace Jarvis.Infrastructure;

public sealed class TaskPersistenceService : IAsyncDisposable
{
    private readonly SqliteConnection _connection;
    private TaskPersistenceService(SqliteConnection connection) => _connection = connection;

    public static async Task<TaskPersistenceService> OpenAsync(string databasePath, CancellationToken cancellationToken = default)
    {
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = databasePath, Mode = SqliteOpenMode.ReadWrite, Pooling = false }.ToString());
        await connection.OpenAsync(cancellationToken);
        return new TaskPersistenceService(connection);
    }

    public async Task CreateAsync(CodingTask task, CancellationToken cancellationToken = default)
    {
        await using var command = _connection.CreateCommand();
        command.CommandText = """
            INSERT INTO tasks(id,project_id,title,state,created_at,updated_at,instruction,working_directory,provider,thread_id,turn_id,error)
            VALUES($id,$project,$title,$state,$created,$updated,$instruction,$cwd,$provider,$thread,$turn,$error)
            """;
        command.Parameters.AddWithValue("$id", task.Id); command.Parameters.AddWithValue("$project", task.ProjectId);
        command.Parameters.AddWithValue("$title", task.Title); command.Parameters.AddWithValue("$state", task.State.ToString());
        command.Parameters.AddWithValue("$created", task.CreatedAt.ToString("O")); command.Parameters.AddWithValue("$updated", task.UpdatedAt.ToString("O"));
        command.Parameters.AddWithValue("$instruction", task.Instruction); command.Parameters.AddWithValue("$cwd", task.WorkingDirectory);
        command.Parameters.AddWithValue("$provider", task.Provider); command.Parameters.AddWithValue("$thread", (object?)task.ThreadId ?? DBNull.Value);
        command.Parameters.AddWithValue("$turn", (object?)task.TurnId ?? DBNull.Value); command.Parameters.AddWithValue("$error", (object?)task.Error ?? DBNull.Value);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task UpdateAsync(string id, CodingTaskState state, string? threadId = null, string? turnId = null, string? error = null, CancellationToken cancellationToken = default)
    {
        await using var command = _connection.CreateCommand();
        command.CommandText = "UPDATE tasks SET state=$state,thread_id=COALESCE($thread,thread_id),turn_id=COALESCE($turn,turn_id),error=$error,updated_at=$at WHERE id=$id";
        command.Parameters.AddWithValue("$id", id); command.Parameters.AddWithValue("$state", state.ToString());
        command.Parameters.AddWithValue("$thread", (object?)threadId ?? DBNull.Value); command.Parameters.AddWithValue("$turn", (object?)turnId ?? DBNull.Value);
        command.Parameters.AddWithValue("$error", (object?)error ?? DBNull.Value); command.Parameters.AddWithValue("$at", DateTimeOffset.UtcNow.ToString("O"));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<CodingTask>> ListAsync(int limit = 100, CancellationToken cancellationToken = default)
    {
        var result = new List<CodingTask>();
        await using var command = _connection.CreateCommand();
        command.CommandText = "SELECT id,project_id,title,instruction,working_directory,state,provider,created_at,updated_at,thread_id,turn_id,error FROM tasks ORDER BY updated_at DESC LIMIT $limit";
        command.Parameters.AddWithValue("$limit", Math.Clamp(limit, 1, 500));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            if (!Enum.TryParse<CodingTaskState>(reader.GetString(5), out var state)) state = CodingTaskState.FAILED;
            result.Add(new CodingTask(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.IsDBNull(3) ? string.Empty : reader.GetString(3),
                reader.IsDBNull(4) ? string.Empty : reader.GetString(4), state, reader.IsDBNull(6) ? "codex" : reader.GetString(6),
                DateTimeOffset.Parse(reader.GetString(7)), DateTimeOffset.Parse(reader.GetString(8)), reader.IsDBNull(9) ? null : reader.GetString(9),
                reader.IsDBNull(10) ? null : reader.GetString(10), reader.IsDBNull(11) ? null : reader.GetString(11)));
        }
        return result;
    }

    public async ValueTask DisposeAsync() => await _connection.DisposeAsync();
}
