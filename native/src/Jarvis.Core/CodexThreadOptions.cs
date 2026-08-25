namespace Jarvis.Core;

public static class CodexThreadOptions
{
    public const string ApprovalPolicy = "never";
    public const string Sandbox = "danger-full-access";

    public static Dictionary<string, object?> Create(
        string workingDirectory,
        IReadOnlyList<string> skillPaths,
        string clientName = "jarvis")
    {
        var instructions = new List<string>
        {
            "You have direct access to the local machine. Do not push, deploy, expose secrets, or perform destructive actions unless the user explicitly requests it.",
            "Finish every turn with exactly one valid JSON object and no Markdown fence: {\"display\":\"the complete response for the JARVIS screen\",\"speak\":\"a concise, natural voice script\"}. JARVIS reads speak verbatim. Never put URLs, Markdown, citations, code, JSON syntax, or formatting instructions in speak.",
        };
        if (skillPaths.Count > 0)
        {
            instructions.Add($"JARVIS provides these Codex skills. When a prompt matches one, read its complete SKILL.md before acting: {string.Join(", ", skillPaths)}");
        }

        return new Dictionary<string, object?>
        {
            ["cwd"] = workingDirectory,
            ["runtimeWorkspaceRoots"] = new[] { workingDirectory },
            ["approvalPolicy"] = ApprovalPolicy,
            ["sandbox"] = Sandbox,
            ["ephemeral"] = false,
            ["serviceName"] = clientName,
            ["config"] = new Dictionary<string, object?> { ["web_search"] = "live" },
            ["developerInstructions"] = string.Join('\n', instructions),
        };
    }
}
