using System.Text.Json;
using Jarvis.Protocol;

namespace Jarvis.Infrastructure;

internal sealed record WakeWordProfile(int Version, string Phrase, IReadOnlyList<float[]> Samples);

internal sealed class WakeWordProfileStore(string path)
{
    private const int CurrentVersion = 1;

    public async Task<WakeWordProfile?> LoadAsync(CancellationToken cancellationToken = default)
    {
        if (!File.Exists(path)) return null;
        await using var stream = File.OpenRead(path);
        var profile = await JsonSerializer.DeserializeAsync<WakeWordProfile>(stream, JarvisJson.Options, cancellationToken);
        return profile is { Version: CurrentVersion, Phrase: "hey jarvis" } && profile.Samples.Count > 0
            ? profile
            : null;
    }

    public async Task SaveAsync(IReadOnlyList<float[]> samples, CancellationToken cancellationToken = default)
    {
        ArgumentOutOfRangeException.ThrowIfZero(samples.Count);
        var directory = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
        var temporaryPath = path + ".tmp";
        await using (var stream = new FileStream(temporaryPath, FileMode.Create, FileAccess.Write, FileShare.None))
        {
            await JsonSerializer.SerializeAsync(stream, new WakeWordProfile(CurrentVersion, "hey jarvis", samples), JarvisJson.Options, cancellationToken);
            await stream.FlushAsync(cancellationToken);
        }
        File.Move(temporaryPath, path, true);
    }
}
