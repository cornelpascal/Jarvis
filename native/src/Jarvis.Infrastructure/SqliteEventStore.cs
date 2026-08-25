using System.Runtime.CompilerServices;
using System.Text.Json;
using Jarvis.Protocol;
using Microsoft.Data.Sqlite;

namespace Jarvis.Infrastructure;

public sealed class SqliteEventStore : IJarvisEventStore, IAsyncDisposable
{
    private readonly SqliteConnection _connection;
    private readonly SemaphoreSlim _gate = new(1, 1);

    private SqliteEventStore(SqliteConnection connection) => _connection = connection;

    public static async Task<SqliteEventStore> OpenAsync(string databasePath, CancellationToken cancellationToken = default)
    {
        var directory = Path.GetDirectoryName(databasePath) ?? throw new ArgumentException("Database path has no directory.", nameof(databasePath));
        Directory.CreateDirectory(directory);
        BackupBeforeNativeMigration(databasePath);
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Shared,
            Pooling = false,
        }.ToString());
        await connection.OpenAsync(cancellationToken);
        await using (var pragma = connection.CreateCommand())
        {
            pragma.CommandText = "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;";
            await pragma.ExecuteNonQueryAsync(cancellationToken);
        }
        await EnsureSchemaAsync(connection, cancellationToken);
        return new SqliteEventStore(connection);
    }

    private static void BackupBeforeNativeMigration(string databasePath)
    {
        if (!File.Exists(databasePath))
        {
            return;
        }
        var marker = databasePath + ".native-backup-complete";
        if (File.Exists(marker))
        {
            return;
        }
        var backup = databasePath + $".pre-native-{DateTimeOffset.UtcNow:yyyyMMddHHmmss}.bak";
        File.Copy(databasePath, backup, overwrite: false);
        File.WriteAllText(marker, Path.GetFileName(backup));
    }

    private static async Task EnsureSchemaAsync(SqliteConnection connection, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = """
            CREATE TABLE IF NOT EXISTS schema_migrations (
              version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
            );
            """;
        await command.ExecuteNonQueryAsync(cancellationToken);

        foreach (var migration in Migrations)
        {
            await using var exists = connection.CreateCommand();
            exists.CommandText = "SELECT COUNT(*) FROM schema_migrations WHERE version = $version";
            exists.Parameters.AddWithValue("$version", migration.Version);
            if (Convert.ToInt32(await exists.ExecuteScalarAsync(cancellationToken)) != 0) continue;

            await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(cancellationToken);
            try
            {
                foreach (var statement in migration.Statements)
                {
                    await using var step = connection.CreateCommand();
                    step.Transaction = transaction;
                    step.CommandText = statement;
                    await step.ExecuteNonQueryAsync(cancellationToken);
                }
                await using var record = connection.CreateCommand();
                record.Transaction = transaction;
                record.CommandText = "INSERT INTO schema_migrations(version, name, applied_at) VALUES ($version, $name, $at)";
                record.Parameters.AddWithValue("$version", migration.Version);
                record.Parameters.AddWithValue("$name", migration.Name);
                record.Parameters.AddWithValue("$at", DateTimeOffset.UtcNow.ToString("O"));
                await record.ExecuteNonQueryAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
            }
            catch
            {
                await transaction.RollbackAsync(cancellationToken);
                throw;
            }
        }
    }

    private sealed record Migration(int Version, string Name, params string[] Statements);

    // Kept byte-for-byte compatible in table/column naming with the Node store.
    private static readonly Migration[] Migrations =
    [
        new(1, "initial_schema",
            "CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS project_roots (id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS project_files (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, path TEXT NOT NULL, hash TEXT, indexed_at TEXT NOT NULL, UNIQUE(project_id, path))",
            "CREATE TABLE IF NOT EXISTS project_symbols (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, file_id TEXT REFERENCES project_files(id) ON DELETE CASCADE, name TEXT NOT NULL, kind TEXT NOT NULL, line INTEGER, metadata_json TEXT NOT NULL DEFAULT '{}')",
            "CREATE TABLE IF NOT EXISTS project_metadata (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, key TEXT NOT NULL, value_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(project_id, key))",
            "CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')), content TEXT NOT NULL, provenance_json TEXT, created_at TEXT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), title TEXT NOT NULL, state TEXT NOT NULL, worktree_path TEXT, branch TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS task_events (event_id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS agent_runs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, provider TEXT NOT NULL, provider_run_id TEXT, state TEXT NOT NULL, started_at TEXT, completed_at TEXT, metadata_json TEXT NOT NULL DEFAULT '{}')",
            "CREATE TABLE IF NOT EXISTS references_store (id TEXT PRIMARY KEY, conversation_id TEXT REFERENCES conversations(id), type TEXT NOT NULL, title TEXT, uri TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, action TEXT NOT NULL, risk_level INTEGER NOT NULL, resource TEXT NOT NULL, project_id TEXT REFERENCES projects(id), state TEXT NOT NULL, reason TEXT NOT NULL, requested_at TEXT NOT NULL, resolved_at TEXT, resolved_by TEXT)",
            "CREATE TABLE IF NOT EXISTS deployment_configs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, environment TEXT NOT NULL, adapter_type TEXT NOT NULL, config_json TEXT NOT NULL, validated_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(project_id, environment))",
            "CREATE TABLE IF NOT EXISTS deployment_runs (id TEXT PRIMARY KEY, config_id TEXT NOT NULL REFERENCES deployment_configs(id), state TEXT NOT NULL, revision TEXT, started_at TEXT NOT NULL, completed_at TEXT, result_json TEXT NOT NULL DEFAULT '{}')",
            "CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, scope TEXT NOT NULL CHECK(scope IN ('EPHEMERAL','SESSION','PROJECT','GLOBAL')), scope_id TEXT, content TEXT NOT NULL, provenance_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT, read_at TEXT, created_at TEXT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS event_log (id TEXT PRIMARY KEY, sequence INTEGER NOT NULL, timestamp TEXT NOT NULL, session_id TEXT, correlation_id TEXT, causation_id TEXT, task_id TEXT, project_id TEXT, type TEXT NOT NULL, source TEXT NOT NULL, schema_version INTEGER NOT NULL, payload_json TEXT NOT NULL)",
            "CREATE INDEX IF NOT EXISTS idx_event_log_timestamp ON event_log(timestamp)",
            "CREATE INDEX IF NOT EXISTS idx_event_log_correlation ON event_log(correlation_id)",
            "CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id)",
            "CREATE INDEX IF NOT EXISTS idx_project_files_project ON project_files(project_id)"),
        new(2, "project_search_index",
            "CREATE TABLE IF NOT EXISTS project_documents (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, path TEXT NOT NULL, file_name TEXT NOT NULL, content TEXT NOT NULL, hash TEXT NOT NULL, language TEXT NOT NULL, size_bytes INTEGER NOT NULL, indexed_at TEXT NOT NULL, UNIQUE(project_id, path))",
            "CREATE TABLE IF NOT EXISTS project_document_symbols (id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES project_documents(id) ON DELETE CASCADE, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, kind TEXT NOT NULL, line INTEGER NOT NULL)",
            "CREATE VIRTUAL TABLE IF NOT EXISTS project_documents_fts USING fts5(document_id UNINDEXED, project_id UNINDEXED, path, content, tokenize = 'unicode61')",
            "CREATE INDEX IF NOT EXISTS idx_project_documents_project ON project_documents(project_id)",
            "CREATE INDEX IF NOT EXISTS idx_project_document_symbols_project_name ON project_document_symbols(project_id, name)"),
        new(3, "coding_task_provider_state",
            "ALTER TABLE tasks ADD COLUMN instruction TEXT", "ALTER TABLE tasks ADD COLUMN working_directory TEXT",
            "ALTER TABLE tasks ADD COLUMN provider TEXT", "ALTER TABLE tasks ADD COLUMN thread_id TEXT",
            "ALTER TABLE tasks ADD COLUMN turn_id TEXT", "ALTER TABLE tasks ADD COLUMN error TEXT"),
        new(4, "worktree_ownership",
            "CREATE TABLE IF NOT EXISTS worktrees (task_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, source_path TEXT NOT NULL, path TEXT NOT NULL UNIQUE, branch TEXT NOT NULL UNIQUE, baseline_revision TEXT NOT NULL, source_dirty INTEGER NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
            "CREATE INDEX IF NOT EXISTS idx_worktrees_project ON worktrees(project_id)"),
        new(5, "permission_receipts", "ALTER TABLE approvals ADD COLUMN action_digest TEXT", "ALTER TABLE approvals ADD COLUMN request_json TEXT",
            "CREATE TABLE IF NOT EXISTS permission_receipts (id TEXT PRIMARY KEY, approval_id TEXT NOT NULL REFERENCES approvals(id) ON DELETE CASCADE, action_digest TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL)",
            "CREATE INDEX IF NOT EXISTS idx_approvals_digest_state ON approvals(action_digest, state)", "CREATE INDEX IF NOT EXISTS idx_permission_receipts_digest ON permission_receipts(action_digest)"),
        new(6, "deployment_proposals", "CREATE TABLE IF NOT EXISTS deployment_proposals (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, environment TEXT NOT NULL, state TEXT NOT NULL, proposal_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)", "CREATE INDEX IF NOT EXISTS idx_deployment_proposals_project ON deployment_proposals(project_id, environment)"),
        new(7, "memory_lifecycle", "ALTER TABLE memories ADD COLUMN confidence REAL NOT NULL DEFAULT 1", "ALTER TABLE memories ADD COLUMN supersedes_id TEXT", "ALTER TABLE memories ADD COLUMN superseded_by TEXT", "ALTER TABLE memories ADD COLUMN deleted_at TEXT", "CREATE INDEX IF NOT EXISTS idx_memories_scope_active ON memories(scope, scope_id, deleted_at, superseded_by)"),
        new(8, "durable_notifications", "ALTER TABLE notifications ADD COLUMN event_id TEXT", "ALTER TABLE notifications ADD COLUMN severity TEXT NOT NULL DEFAULT 'info'", "ALTER TABLE notifications ADD COLUMN project_id TEXT", "ALTER TABLE notifications ADD COLUMN task_id TEXT", "CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_event ON notifications(event_id)", "CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(read_at, created_at)"),
        new(9, "direct_workspace_tasks", "ALTER TABLE worktrees RENAME TO worktrees_unique_legacy", "CREATE TABLE worktrees (task_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, source_path TEXT NOT NULL, path TEXT NOT NULL, branch TEXT NOT NULL, baseline_revision TEXT NOT NULL, source_dirty INTEGER NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)", "INSERT INTO worktrees(task_id, project_id, source_path, path, branch, baseline_revision, source_dirty, state, created_at, updated_at) SELECT task_id, project_id, source_path, path, branch, baseline_revision, source_dirty, state, created_at, updated_at FROM worktrees_unique_legacy", "DROP TABLE worktrees_unique_legacy", "CREATE INDEX idx_worktrees_project ON worktrees(project_id)", "CREATE INDEX idx_worktrees_path ON worktrees(path)"),
    ];

    public async ValueTask<long> LatestSequenceAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            await using var command = _connection.CreateCommand();
            command.CommandText = "SELECT COALESCE(MAX(sequence), -1) FROM event_log";
            return Convert.ToInt64(await command.ExecuteScalarAsync(cancellationToken));
        }
        finally
        {
            _gate.Release();
        }
    }

    public async ValueTask AppendAsync(JarvisEvent value, CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            await using var transaction = (SqliteTransaction)await _connection.BeginTransactionAsync(cancellationToken);
            await using var command = _connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = """
                INSERT INTO event_log(
                  id, sequence, timestamp, session_id, correlation_id, causation_id, task_id,
                  project_id, type, source, schema_version, payload_json
                ) VALUES ($id, $sequence, $timestamp, $session, $correlation, $causation, $task,
                  $project, $type, $source, $schema, $payload)
                """;
            command.Parameters.AddWithValue("$id", value.Id.ToString());
            command.Parameters.AddWithValue("$sequence", value.Sequence);
            command.Parameters.AddWithValue("$timestamp", value.Timestamp.ToString("O"));
            command.Parameters.AddWithValue("$session", (object?)value.SessionId ?? DBNull.Value);
            command.Parameters.AddWithValue("$correlation", (object?)value.CorrelationId ?? DBNull.Value);
            command.Parameters.AddWithValue("$causation", (object?)value.CausationId ?? DBNull.Value);
            command.Parameters.AddWithValue("$task", (object?)value.TaskId ?? DBNull.Value);
            command.Parameters.AddWithValue("$project", (object?)value.ProjectId ?? DBNull.Value);
            command.Parameters.AddWithValue("$type", value.Type);
            command.Parameters.AddWithValue("$source", value.Source);
            command.Parameters.AddWithValue("$schema", value.SchemaVersion);
            command.Parameters.AddWithValue("$payload", value.Payload.GetRawText());
            await command.ExecuteNonQueryAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async IAsyncEnumerable<JarvisEvent> ReadAfterAsync(
        long sequence,
        int limit,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var values = new List<JarvisEvent>();
        await _gate.WaitAsync(cancellationToken);
        try
        {
            await using var command = _connection.CreateCommand();
            command.CommandText = """
                SELECT id, sequence, timestamp, session_id, correlation_id, causation_id, task_id,
                  project_id, type, source, schema_version, payload_json
                FROM event_log WHERE sequence > $sequence ORDER BY sequence ASC LIMIT $limit
                """;
            command.Parameters.AddWithValue("$sequence", sequence);
            command.Parameters.AddWithValue("$limit", Math.Clamp(limit, 1, 500));
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                using var payload = JsonDocument.Parse(reader.GetString(11));
                values.Add(new JarvisEvent(
                    Guid.Parse(reader.GetString(0)),
                    reader.GetInt64(1),
                    DateTimeOffset.Parse(reader.GetString(2)),
                    reader.GetString(8),
                    reader.GetString(9),
                    payload.RootElement.Clone(),
                    reader.GetInt32(10),
                    reader.IsDBNull(3) ? null : reader.GetString(3),
                    reader.IsDBNull(4) ? null : reader.GetString(4),
                    reader.IsDBNull(5) ? null : reader.GetString(5),
                    reader.IsDBNull(6) ? null : reader.GetString(6),
                    reader.IsDBNull(7) ? null : reader.GetString(7)));
            }
        }
        finally
        {
            _gate.Release();
        }
        foreach (var value in values)
        {
            yield return value;
        }
    }

    public async ValueTask DisposeAsync()
    {
        await _connection.DisposeAsync();
        _gate.Dispose();
    }
}
