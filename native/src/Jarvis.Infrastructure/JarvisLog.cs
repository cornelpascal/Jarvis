using System.Text.Json;

namespace Jarvis.Infrastructure;

public static class JarvisLog
{
    private static readonly object Gate = new();

    public static void Write(string level, string source, string message, Exception? exception = null)
    {
        try
        {
            var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Jarvis", "logs");
            Directory.CreateDirectory(directory);
            var line = JsonSerializer.Serialize(new
            {
                timestamp = DateTimeOffset.UtcNow,
                level,
                source,
                message,
                exception = exception?.ToString(),
            });
            lock (Gate) File.AppendAllText(Path.Combine(directory, $"jarvis-{DateTime.UtcNow:yyyyMMdd}.jsonl"), line + Environment.NewLine);
        }
        catch
        {
            // Logging must never become a second crash path.
        }
    }
}
