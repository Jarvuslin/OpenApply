using System.Text.RegularExpressions;

namespace OpenApply.Terminal.Agent;

internal static partial class AgentRedaction
{
    public static string Clean(string content, string apiToken)
    {
        var value = string.IsNullOrEmpty(apiToken) ? content : content.Replace(apiToken, "[redacted]", StringComparison.Ordinal);
        value = Credential().Replace(value, "$1[redacted]");
        value = Bearer().Replace(value, "Bearer [redacted]");
        return value.Length <= 30000 ? value : value[..30000] + "\n[Message truncated]";
    }

    [GeneratedRegex("(?im)((?:password|passwd|api[_ -]?key|api[_ -]?token|access[_ -]?token|secret)[\\\"']?\\s*[=:]\\s*[\\\"']?)[^\\s\\\"',;]+")]
    private static partial Regex Credential();

    [GeneratedRegex("(?i)Bearer\\s+[A-Za-z0-9._~+/-]+=*")]
    private static partial Regex Bearer();
}
