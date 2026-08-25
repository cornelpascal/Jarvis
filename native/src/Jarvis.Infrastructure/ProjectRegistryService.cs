using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Jarvis.Protocol;
using Microsoft.Data.Sqlite;

namespace Jarvis.Infrastructure;

public sealed class ProjectRegistryService : IAsyncDisposable
{
    private static readonly HashSet<string> Signals = new(StringComparer.OrdinalIgnoreCase)
    {
        ".git", "package.json", "pnpm-lock.yaml", "yarn.lock", "requirements.txt",
        "pyproject.toml", "cargo.toml", "go.mod", "dockerfile", "compose.yml",
        "docker-compose.yml", "agents.md",
    };
    private readonly SqliteConnection _connection;

    private ProjectRegistryService(SqliteConnection connection) => _connection = connection;

    public static async Task<ProjectRegistryService> OpenAsync(string databasePath, CancellationToken cancellationToken = default)
    {
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadWrite,
            Pooling = false,
        }.ToString());
        await connection.OpenAsync(cancellationToken);
        return new ProjectRegistryService(connection);
    }

    public async Task<IReadOnlyList<ProjectRecord>> SynchronizeAsync(IEnumerable<string> roots, CancellationToken cancellationToken = default)
    {
        foreach (var configuredRoot in roots)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var root = Path.GetFullPath(configuredRoot);
            if (!Directory.Exists(root)) continue;
            await UpsertRootAsync(root, cancellationToken);
            await TryRegisterAsync(root, manual: false, cancellationToken);
            IEnumerable<string> children;
            try { children = Directory.EnumerateDirectories(root).Take(2_000).ToArray(); }
            catch (UnauthorizedAccessException) { continue; }
            foreach (var child in children)
            {
                cancellationToken.ThrowIfCancellationRequested();
                await TryRegisterAsync(child, manual: true, cancellationToken);
            }
        }
        return await ListAsync(cancellationToken);
    }

    public async Task<ProjectRecord> RegisterAsync(string path, CancellationToken cancellationToken = default)
    {
        var fullPath = Path.GetFullPath(path);
        if (!Directory.Exists(fullPath)) throw new DirectoryNotFoundException(fullPath);
        return await TryRegisterAsync(fullPath, manual: true, cancellationToken)
            ?? throw new InvalidOperationException("Project could not be registered.");
    }

    public async Task<IReadOnlyList<ProjectRecord>> ListAsync(CancellationToken cancellationToken = default)
    {
        var result = new List<ProjectRecord>();
        await using var command = _connection.CreateCommand();
        command.CommandText = "SELECT id, name, path, enabled, created_at, updated_at FROM projects ORDER BY name COLLATE NOCASE, path";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add(new ProjectRecord(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetInt32(3) == 1,
                Directory.Exists(Path.Combine(reader.GetString(2), ".git")), DateTimeOffset.Parse(reader.GetString(4)), DateTimeOffset.Parse(reader.GetString(5))));
        }
        return result;
    }

    private async Task<ProjectRecord?> TryRegisterAsync(string path, bool manual, CancellationToken cancellationToken)
    {
        string[] entries;
        try { entries = Directory.EnumerateFileSystemEntries(path).Select(Path.GetFileName).Where(value => value is not null).Cast<string>().ToArray(); }
        catch (Exception error) when (error is UnauthorizedAccessException or IOException) { return null; }
        var detected = entries.Where(value => Signals.Contains(value) || value.StartsWith("README", StringComparison.OrdinalIgnoreCase) || value.EndsWith(".sln", StringComparison.OrdinalIgnoreCase) || value.EndsWith(".csproj", StringComparison.OrdinalIgnoreCase)).ToArray();
        if (!manual && detected.Length == 0) return null;
        var id = StableId("project", path);
        var now = DateTimeOffset.UtcNow;
        var isGit = entries.Contains(".git", StringComparer.OrdinalIgnoreCase);
        await using var transaction = (SqliteTransaction)await _connection.BeginTransactionAsync(cancellationToken);
        await using (var command = _connection.CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = "INSERT INTO projects(id,name,path,enabled,created_at,updated_at) VALUES($id,$name,$path,1,$at,$at) ON CONFLICT(path) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at";
            command.Parameters.AddWithValue("$id", id); command.Parameters.AddWithValue("$name", Path.GetFileName(path.TrimEnd(Path.DirectorySeparatorChar)));
            command.Parameters.AddWithValue("$path", path); command.Parameters.AddWithValue("$at", now.ToString("O"));
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
        await using (var metadata = _connection.CreateCommand())
        {
            metadata.Transaction = transaction;
            metadata.CommandText = "INSERT INTO project_metadata(project_id,key,value_json,updated_at) VALUES($id,'analysis',$json,$at) ON CONFLICT(project_id,key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at";
            metadata.Parameters.AddWithValue("$id", id); metadata.Parameters.AddWithValue("$json", JsonSerializer.Serialize(new { signals = detected, git = new { enabled = isGit } }, JarvisJson.Options)); metadata.Parameters.AddWithValue("$at", now.ToString("O"));
            await metadata.ExecuteNonQueryAsync(cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
        return new ProjectRecord(id, Path.GetFileName(path.TrimEnd(Path.DirectorySeparatorChar)), path, true, isGit, now, now);
    }

    private async Task UpsertRootAsync(string path, CancellationToken cancellationToken)
    {
        await using var command = _connection.CreateCommand();
        command.CommandText = "INSERT INTO project_roots(id,path,enabled,created_at,updated_at) VALUES($id,$path,1,$at,$at) ON CONFLICT(path) DO UPDATE SET updated_at=excluded.updated_at";
        command.Parameters.AddWithValue("$id", StableId("root", path)); command.Parameters.AddWithValue("$path", path); command.Parameters.AddWithValue("$at", DateTimeOffset.UtcNow.ToString("O"));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static string StableId(string prefix, string value)
    {
        var hash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value.ToLowerInvariant())));
        return $"{prefix}-{hash[..16]}";
    }

    public async ValueTask DisposeAsync() => await _connection.DisposeAsync();
}
