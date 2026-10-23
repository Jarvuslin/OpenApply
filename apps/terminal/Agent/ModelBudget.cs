using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace OpenApply.Terminal.Agent;

internal sealed class ModelBudgetException(string reason, string code = "invalid usage metadata") : InvalidOperationException(reason)
{
    internal string Code { get; } = code;
}

internal sealed record ModelBudget(long MaxRequests, long MaxTokens, int MaxSubagents, int MaxTurns,
    int MaxWorkerTurns, decimal MaxBudgetUsd, int MaxSeconds, string? LedgerPath)
{
    internal const string EnvironmentKey = "OPENAPPLY_MODEL_BUDGET";
    internal const string LedgerKey = "OPENAPPLY_USAGE_LEDGER";
    internal HashSet<string> BoundedAgentTypes { get; } = [];
    internal ModelUsageContext? UsageContext { get; init; }
    private static readonly string[] Fields = ["maxRequests", "maxTokens", "maxSubagents", "maxTurns", "maxWorkerTurns", "maxBudgetUsd", "maxSeconds"];

    internal static ModelBudget? Read(Func<string, string?> get)
    {
        var raw = get(EnvironmentKey);
        if (raw is null) return null;
        try
        {
            var value = JsonNode.Parse(raw) as JsonObject ?? throw new FormatException();
            if (value.Any(entry => !Fields.Contains(entry.Key))) throw new FormatException();
            var requests = Integer(value, "maxRequests", allowZero: true);
            if (requests == 0) return new(0, 0, 0, 0, 0, 0, 0, null);
            var path = get(LedgerKey);
            if (string.IsNullOrWhiteSpace(path) || !Path.IsPathFullyQualified(path)) throw new FormatException();
            var cost = value["maxBudgetUsd"]?.GetValue<decimal>() ?? throw new FormatException();
            if (cost <= 0 || cost > 1_000_000) throw new FormatException();
            var seconds = Integer(value, "maxSeconds");
            if (seconds > 86_400) throw new FormatException();
            return new(requests, Integer(value, "maxTokens"), checked((int)Integer(value, "maxSubagents", true)),
                checked((int)Integer(value, "maxTurns")), checked((int)Integer(value, "maxWorkerTurns")), cost,
                checked((int)seconds), Path.GetFullPath(path));
        }
        catch (Exception ex) when (ex is System.Text.Json.JsonException or FormatException or InvalidOperationException or OverflowException or ArgumentException)
        {
            throw new ModelBudgetException("Model launch denied: invalid or incomplete local model budget.");
        }
    }

    internal void ValidateLaunch(string provider, string? sessionId, IEnumerable<KeyValuePair<string, string?>> environment)
    {
        if (MaxRequests == 0) throw new ModelBudgetException("Model launch denied: the local model-call budget is zero.");
        if (provider != "claude") throw new ModelBudgetException("Model launch denied: bounded acceptance permits only the approved Claude provider.");
        if (sessionId is not null) throw new ModelBudgetException("Model launch denied: bounded acceptance cannot resume a provider session.");
        if (environment.Any(entry => entry.Key.Equals("CLAUDE_CONFIG_DIR", StringComparison.OrdinalIgnoreCase) && entry.Value is not null))
            throw new ModelBudgetException("Model launch denied: bounded acceptance requires the default Claude authentication directory.");
        if (environment.Any(entry => !string.IsNullOrEmpty(entry.Value) && IsRoutingKey(entry.Key)))
            throw new ModelBudgetException("Model launch denied: API-key or alternate-provider routing is configured.");
    }

    internal void ValidatePlugin(string pluginDir)
    {
        var settings = Path.Combine(pluginDir, "settings", "claude.json");
        if (!File.Exists(settings)) throw new ModelBudgetException("Model launch denied: bounded acceptance requires explicit local Claude settings.");
        JsonNode? value;
        try { value = JsonNode.Parse(File.ReadAllText(settings)); }
        catch (System.Text.Json.JsonException) { throw new ModelBudgetException("Model launch denied: invalid local Claude settings."); }
        if (value is not JsonObject || HasRoutingSetting(value))
            throw new ModelBudgetException("Model launch denied: Claude settings contain API-key or alternate-provider routing.");
        var agents = Path.Combine(pluginDir, "agents");
        if (!Directory.Exists(agents)) throw new ModelBudgetException("Model launch denied: bounded acceptance requires staged agent turn limits.");
        BoundedAgentTypes.Clear();
        foreach (var file in Directory.EnumerateFiles(agents, "*.md", SearchOption.AllDirectories))
        {
            var text = File.ReadAllText(file);
            var header = Regex.Match(text, @"\A---\r?\n(?<header>[\s\S]*?)\r?\n---(?:\r?\n|\z)");
            var turns = Regex.Matches(header.Groups["header"].Value, @"(?m)^maxTurns:[ \t]*(\d+)[ \t]*\r?$");
            if (!header.Success || turns.Count != 1 || !int.TryParse(turns[0].Groups[1].Value, out var limit) || limit <= 0 || limit > MaxWorkerTurns)
                throw new ModelBudgetException("Model launch denied: a staged agent lacks an approved finite worker-turn limit.");
            var names = Regex.Matches(header.Groups["header"].Value, @"(?m)^name:[ \t]*([a-zA-Z0-9_-]+)[ \t]*\r?$");
            if (names.Count != 1) throw new ModelBudgetException("Model launch denied: a staged agent lacks an unambiguous name.");
            var models = Regex.Matches(header.Groups["header"].Value, @"(?m)^model:[ \t]*(\S+)[ \t]*\r?$");
            var modelFields = Regex.Matches(header.Groups["header"].Value, @"(?m)^[ \t]*model[ \t]*:.*$");
            if (models.Count != modelFields.Count || models.Count > 1 || models.Count == 1 && models[0].Groups[1].Value is not ("sonnet" or "inherit"))
                throw new ModelBudgetException("Model launch denied: a staged agent changes the approved Sonnet model.");
            BoundedAgentTypes.Add(names[0].Groups[1].Value);
            BoundedAgentTypes.Add("openapply:" + names[0].Groups[1].Value);
        }
    }

    internal void ValidateSubagent(string? type, JsonNode? model = null)
    {
        if (type is null || !BoundedAgentTypes.Contains(type))
            throw new ModelBudgetException("Model stopped: an unbounded subagent was requested.", "unbounded subagent requested");
        if (model is not null && (model is not JsonValue value || !value.TryGetValue<string>(out var name) || name is not ("sonnet" or "inherit")))
            throw new ModelBudgetException("Model stopped: a subagent changed the approved Sonnet model.", "unapproved subagent model requested");
    }

    internal static void ValidateSubscription(string configDir, string userSettingsFile)
    {
        try
        {
            var credentials = JsonNode.Parse(File.ReadAllText(Path.Combine(configDir, ".credentials.json")));
            if (AgentJson.Text(credentials?["claudeAiOauth"], "subscriptionType") is not ("pro" or "max"))
                throw new ModelBudgetException("Model launch denied: Pro or Max subscription authentication was not verified locally.");
            if (File.Exists(userSettingsFile) && JsonNode.Parse(File.ReadAllText(userSettingsFile))?["primaryApiKey"] is not null)
                throw new ModelBudgetException("Model launch denied: stored API-key authentication is configured.");
        }
        catch (Exception ex) when ((ex is IOException or UnauthorizedAccessException or System.Text.Json.JsonException or InvalidOperationException) && ex is not ModelBudgetException)
        {
            throw new ModelBudgetException("Model launch denied: local subscription authentication metadata is unavailable or invalid.");
        }
    }

    internal void AddArguments(List<string> args) => args.AddRange([
        "--model", "sonnet",
        "--max-turns", MaxTurns.ToString(CultureInfo.InvariantCulture),
        "--max-budget-usd", MaxBudgetUsd.ToString(CultureInfo.InvariantCulture),
        "--setting-sources", ""
    ]);

    internal string? Reached(ClaudeUsageTotals usage)
    {
        if (usage.Requests >= MaxRequests) return "observed request budget reached";
        if (usage.TotalTokens >= MaxTokens) return "observed token budget reached";
        if (usage.Subagents > 0 && usage.Subagents >= MaxSubagents) return "subagent-start budget reached";
        return null;
    }

    private static long Integer(JsonObject value, string key, bool allowZero = false)
    {
        var number = value[key]?.GetValue<long>() ?? throw new FormatException();
        if (number < (allowZero ? 0 : 1) || number > 9_007_199_254_740_991) throw new FormatException();
        return number;
    }

    private static bool IsRoutingKey(string key) => key.Equals("ANTHROPIC_API_KEY", StringComparison.OrdinalIgnoreCase)
        || key.Equals("ANTHROPIC_AUTH_TOKEN", StringComparison.OrdinalIgnoreCase)
        || key.Equals("ANTHROPIC_BASE_URL", StringComparison.OrdinalIgnoreCase)
        || key.Equals("CLAUDE_CONFIG_DIR", StringComparison.OrdinalIgnoreCase)
        || key.Equals("CLAUDE_CODE_OAUTH_TOKEN", StringComparison.OrdinalIgnoreCase)
        || key.Equals("CLAUDE_CODE_OAUTH_TOKEN_FILE", StringComparison.OrdinalIgnoreCase)
        || key.Equals("ANTHROPIC_MODEL", StringComparison.OrdinalIgnoreCase)
        || key.StartsWith("ANTHROPIC_DEFAULT_", StringComparison.OrdinalIgnoreCase)
        || key.Equals("CLAUDE_CODE_SUBAGENT_MODEL", StringComparison.OrdinalIgnoreCase)
        || key.StartsWith("ANTHROPIC_FOUNDRY_", StringComparison.OrdinalIgnoreCase)
        || key.Equals("CLAUDE_CODE_USE_BEDROCK", StringComparison.OrdinalIgnoreCase)
        || key.Equals("CLAUDE_CODE_USE_VERTEX", StringComparison.OrdinalIgnoreCase)
        || key.Equals("CLAUDE_CODE_USE_FOUNDRY", StringComparison.OrdinalIgnoreCase);

    private static bool HasRoutingSetting(JsonNode? node)
    {
        if (node is JsonObject obj)
            return obj.Any(entry => entry.Key.Equals("apiKeyHelper", StringComparison.OrdinalIgnoreCase) || IsRoutingKey(entry.Key) || HasRoutingSetting(entry.Value));
        return node is JsonArray array && array.Any(HasRoutingSetting);
    }
}
