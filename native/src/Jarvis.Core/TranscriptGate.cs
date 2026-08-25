using System.Text.RegularExpressions;

namespace Jarvis.Core;

public static partial class TranscriptGate
{
    [GeneratedRegex(@"\bjarvis\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex JarvisWord();

    [GeneratedRegex(@"^\s*(?:hey\s+)?jarvis\b[\s,:;.!?-]*", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex LeadingAddress();

    public static bool TryExtractCommand(string transcript, out string command)
    {
        command = string.Empty;
        if (string.IsNullOrWhiteSpace(transcript) || !JarvisWord().IsMatch(transcript))
        {
            return false;
        }

        command = LeadingAddress().Replace(transcript.Trim(), string.Empty).Trim();
        return command.Length > 0;
    }
}
