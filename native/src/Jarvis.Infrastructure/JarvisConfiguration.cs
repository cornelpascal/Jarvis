using YamlDotNet.Serialization;
using YamlDotNet.Serialization.NamingConventions;

namespace Jarvis.Infrastructure;

public sealed record JarvisConfiguration
{
    public string AppName { get; init; } = "JARVIS";
    public string DataDirectory { get; init; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Jarvis");
    public string CodexExecutable { get; init; } = "codex";
    public int MaximumConcurrentAgents { get; init; } = 4;
    public bool VoiceEnabled { get; init; } = true;
    public string VoiceModel { get; init; } = "gpt-realtime";
    public string TranscriptionModel { get; init; } = "gpt-4o-mini-transcribe";
    public int SilenceDurationMilliseconds { get; init; } = 1_000;
    public bool WakeWordEnabled { get; init; } = true;
    public float WakeWordThreshold { get; init; } = 0.5f;
    public int WakeWordCooldownMilliseconds { get; init; } = 5_000;
    public IReadOnlyList<string> ProjectRoots { get; init; } =
        [Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Documents")];

    public string DatabasePath => Path.Combine(DataDirectory, "jarvis.sqlite");
    public string LogsDirectory => Path.Combine(DataDirectory, "logs");
    public string? OpenAiApiKey => ResolveOpenAiApiKey();

    public static JarvisConfiguration Load(string? path = null)
    {
        var configuration = new JarvisConfiguration();
        path ??= Environment.GetEnvironmentVariable("JARVIS_CONFIG_PATH")
            ?? Path.Combine(AppContext.BaseDirectory, "jarvis.config.yaml");
        if (File.Exists(path))
        {
            var yaml = new DeserializerBuilder()
                .WithNamingConvention(UnderscoredNamingConvention.Instance)
                .IgnoreUnmatchedProperties()
                .Build()
                .Deserialize<LegacyConfiguration>(File.ReadAllText(path));
            configuration = configuration with
            {
                AppName = yaml.App?.Name ?? configuration.AppName,
                VoiceEnabled = yaml.Voice?.Enabled ?? configuration.VoiceEnabled,
                MaximumConcurrentAgents = yaml.Codex?.MaxConcurrentAgents ?? configuration.MaximumConcurrentAgents,
                WakeWordEnabled = yaml.WakeWord?.Enabled ?? configuration.WakeWordEnabled,
                WakeWordThreshold = yaml.WakeWord?.Threshold ?? configuration.WakeWordThreshold,
                WakeWordCooldownMilliseconds = yaml.WakeWord?.CooldownMs ?? configuration.WakeWordCooldownMilliseconds,
                ProjectRoots = yaml.Projects?.Roots?.Select(ExpandEnvironmentPath).ToArray() ?? configuration.ProjectRoots,
            };
        }
        var explicitData = Environment.GetEnvironmentVariable("JARVIS_DATA_DIR");
        if (!string.IsNullOrWhiteSpace(explicitData))
        {
            configuration = configuration with { DataDirectory = Path.GetFullPath(explicitData) };
        }
        var explicitRoots = Environment.GetEnvironmentVariable("JARVIS_PROJECT_ROOTS");
        if (!string.IsNullOrWhiteSpace(explicitRoots))
        {
            configuration = configuration with
            {
                ProjectRoots = explicitRoots.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .Select(ExpandEnvironmentPath).ToArray(),
            };
        }
        return configuration;
    }

    private static string ExpandEnvironmentPath(string path)
    {
        foreach (System.Collections.DictionaryEntry variable in Environment.GetEnvironmentVariables())
        {
            path = path.Replace($"%{variable.Key}%", variable.Value?.ToString(), StringComparison.OrdinalIgnoreCase);
        }
        return Path.GetFullPath(path);
    }

    private static string? ResolveOpenAiApiKey()
    {
        var processValue = Environment.GetEnvironmentVariable("OPENAI_API_KEY");
        if (!string.IsNullOrWhiteSpace(processValue)) return processValue;

        foreach (var path in OpenAiEnvironmentFiles().Distinct(StringComparer.OrdinalIgnoreCase))
        {
            try
            {
                if (!File.Exists(path)) continue;
                foreach (var line in File.ReadLines(path))
                {
                    var candidate = line.Trim();
                    if (candidate.StartsWith("export ", StringComparison.OrdinalIgnoreCase))
                    {
                        candidate = candidate[7..].TrimStart();
                    }
                    var separator = candidate.IndexOf('=');
                    if (separator <= 0 || !candidate[..separator].Trim().Equals("OPENAI_API_KEY", StringComparison.Ordinal))
                    {
                        continue;
                    }
                    var value = candidate[(separator + 1)..].Trim();
                    if (value.Length >= 2 && ((value[0] == '"' && value[^1] == '"') || (value[0] == '\'' && value[^1] == '\'')))
                    {
                        value = value[1..^1];
                    }
                    if (!string.IsNullOrWhiteSpace(value)) return value;
                }
            }
            catch (IOException)
            {
            }
            catch (UnauthorizedAccessException)
            {
            }
        }
        return null;
    }

    private static IEnumerable<string> OpenAiEnvironmentFiles()
    {
        var explicitPath = Environment.GetEnvironmentVariable("JARVIS_ENV_PATH");
        if (!string.IsNullOrWhiteSpace(explicitPath)) yield return Path.GetFullPath(explicitPath);
        yield return Path.Combine(Directory.GetCurrentDirectory(), ".env");

        DirectoryInfo? directory = new(AppContext.BaseDirectory);
        for (var level = 0; level < 4 && directory is not null; level++, directory = directory.Parent)
        {
            yield return Path.Combine(directory.FullName, ".env");
        }
    }

    private sealed record LegacyConfiguration
    {
        public AppSection? App { get; init; }
        public VoiceSection? Voice { get; init; }
        public WakeWordSection? WakeWord { get; init; }
        public CodexSection? Codex { get; init; }
        public ProjectsSection? Projects { get; init; }
    }
    private sealed record AppSection { public string? Name { get; init; } }
    private sealed record VoiceSection { public bool? Enabled { get; init; } }
    private sealed record WakeWordSection
    {
        public bool? Enabled { get; init; }
        public float? Threshold { get; init; }
        public int? CooldownMs { get; init; }
    }
    private sealed record CodexSection { public int? MaxConcurrentAgents { get; init; } }
    private sealed record ProjectsSection { public List<string>? Roots { get; init; } }
}
