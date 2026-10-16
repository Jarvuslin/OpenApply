using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace OpenApply.Terminal.Agent;

internal sealed record ModelUsageContext(string RunId, string AllocationId, string WorkItemId, string Mode, string RequestedModel,
    string? ExecutionId = null, string? PluginSourceHash = null);

internal sealed record ClaudeTokenUsage(long Input = 0, long CacheWrite = 0, long CacheRead = 0, long Output = 0)
{
    internal long Total => checked(Input + CacheWrite + CacheRead + Output);
    internal ClaudeTokenUsage Max(ClaudeTokenUsage other) => new(Math.Max(Input, other.Input), Math.Max(CacheWrite, other.CacheWrite), Math.Max(CacheRead, other.CacheRead), Math.Max(Output, other.Output));
    internal ClaudeTokenUsage Add(ClaudeTokenUsage other) => new(checked(Input + other.Input), checked(CacheWrite + other.CacheWrite), checked(CacheRead + other.CacheRead), checked(Output + other.Output));
    internal JsonObject Json() => new() { ["inputTokens"] = Input, ["cacheWriteTokens"] = CacheWrite, ["cacheReadTokens"] = CacheRead, ["outputTokens"] = Output };
}

internal sealed record ClaudeUsageTotals(long Requests, ClaudeTokenUsage Tokens, int Subagents)
{
    internal long TotalTokens => Tokens.Total;
    internal JsonObject Json() => new() { ["requests"] = Requests, ["tokens"] = Tokens.Json(), ["totalTokenOccurrences"] = TotalTokens, ["subagentStarts"] = Subagents };
}

internal sealed class ClaudeUsageLedger : IDisposable
{
    private sealed record Request(string Scope, ClaudeTokenUsage Usage);
    private readonly StreamWriter writer;
    private readonly ModelBudget budget;
    private readonly Dictionary<string, int> aliases = [];
    private readonly List<Request> requests = [];
    private readonly Dictionary<string, ClaudeTokenUsage> childResults = [];
    private readonly HashSet<string> subagents = [];
    private ClaudeTokenUsage finalUsage = new();
    private decimal listCost;
    private bool finished;
    private readonly long started = Stopwatch.GetTimestamp();
    private readonly HashSet<string> actualModels = [];
    private bool usageObserved;
    private bool finalUsageObserved;
    private bool listCostObserved;
    private int writtenBytes;
    private int writtenEvents;

    internal ClaudeUsageLedger(ModelBudget budget)
    {
        this.budget = budget;
        // A fresh ledger is also a one-launch latch; reusing a stopped run must never launch again.
        writer = new StreamWriter(new FileStream(budget.LedgerPath!, FileMode.CreateNew, FileAccess.Write, FileShare.Read), new UTF8Encoding(false)) { AutoFlush = true };
        Write(new JsonObject
        {
            ["event"] = "budget", ["maxRequests"] = budget.MaxRequests, ["maxTokens"] = budget.MaxTokens,
            ["maxSubagents"] = budget.MaxSubagents, ["maxTurns"] = budget.MaxTurns, ["maxWorkerTurns"] = budget.MaxWorkerTurns,
            ["maxBudgetUsdListEquivalent"] = budget.MaxBudgetUsd, ["maxSeconds"] = budget.MaxSeconds,
            ["measurement"] = "observed stream usage; response-time limits can overshoot; not Pro allowance percentage",
            ["provider"] = "claude", ["requestedModel"] = budget.UsageContext?.RequestedModel ?? "sonnet",
            ["runId"] = budget.UsageContext?.RunId, ["allocationId"] = budget.UsageContext?.AllocationId,
            ["workItemId"] = budget.UsageContext?.WorkItemId, ["mode"] = budget.UsageContext?.Mode,
            ["executionId"] = budget.UsageContext?.ExecutionId, ["pluginSourceHash"] = budget.UsageContext?.PluginSourceHash
        });
    }

    internal ClaudeUsageTotals Totals
    {
        get
        {
            var scopes = requests.GroupBy(item => item.Scope).ToDictionary(group => group.Key, group => group.Aggregate(new ClaudeTokenUsage(), (sum, item) => sum.Add(item.Usage)));
            foreach (var (scope, usage) in childResults) scopes[scope] = scopes.GetValueOrDefault(scope, new()).Max(usage);
            var total = scopes.Values.Aggregate(new ClaudeTokenUsage(), (sum, usage) => sum.Add(usage));
            // Parent results/modelUsage are cumulative: use them as a floor, never add them again.
            return new(requests.Count, total.Max(finalUsage), subagents.Count);
        }
    }

    internal void Observe(JsonObject message)
    {
        var type = AgentJson.Text(message, "type");
        var parent = AgentJson.Text(message, "parent_tool_use_id");
        var scope = parent is null ? "parent" : Hash(parent);
        if (type == "assistant" && message["message"] is JsonObject assistant)
        {
            if (AgentJson.Text(assistant, "model") == "<synthetic>") return;
            if (assistant["usage"] is not JsonObject)
                throw new ModelBudgetException("Model stopped: a provider response lacked usage metadata.");
            var messageId = AgentJson.Text(assistant, "id");
            var requestId = AgentJson.Text(message, "requestId") ?? AgentJson.Text(message, "request_id") ?? AgentJson.Text(assistant, "request_id");
            if (messageId is null && requestId is null)
                throw new ModelBudgetException("Model stopped: a provider response lacked a deduplicatable usage identity.");
            var keys = new[] { messageId is null ? null : "message:" + Hash(messageId), requestId is null ? null : "request:" + Hash(requestId) }.OfType<string>().ToArray();
            var known = keys.Where(aliases.ContainsKey).Select(key => aliases[key]).Distinct().ToArray();
            if (known.Length > 1) throw new ModelBudgetException("Model stopped: provider usage identities conflict.");
            var index = known.Length == 1 ? known[0] : requests.Count;
            var usage = ReadUsage(assistant["usage"], false);
            if (requests.Count >= 10000 || aliases.Count >= 20000)
                throw new ModelBudgetException("Model stopped: usage identity tracking exceeded its bound.", "usage tracking limit reached");
            if (index == requests.Count) requests.Add(new(scope, usage));
            else requests[index] = requests[index] with { Usage = requests[index].Usage.Max(usage) };
            foreach (var key in keys) aliases[key] = index;
            // Valid measured counters survive a rejected label or tool declaration on the same response.
            usageObserved = true;
            Model(AgentJson.Text(assistant, "model"));
            if (assistant["content"] is JsonArray blocks)
            {
                foreach (var block in blocks.OfType<JsonObject>())
                {
                    if (AgentJson.Text(block, "type") != "tool_use" || AgentJson.Text(block, "name") is not ("Agent" or "Task")) continue;
                    var toolId = AgentJson.Text(block, "id") ?? throw new ModelBudgetException("Model stopped: a subagent start lacked an identity.");
                    subagents.Add(Hash(toolId));
                    budget.ValidateSubagent(AgentJson.Text(block["input"], "subagent_type"), block["input"]?["model"]);
                }
            }
            Write(new JsonObject { ["event"] = "response", ["scope"] = scope, ["requestIdentityHash"] = Hash(keys[0]), ["usage"] = requests[index].Usage.Json(), ["totals"] = Totals.Json() });
        }
        if (type == "result")
        {
            var usage = message["usage"] is null ? new ClaudeTokenUsage() : ReadUsage(message["usage"], false);
            var available = message["usage"] is not null;
            if (message["modelUsage"] is JsonObject models)
            {
                usage = usage.Max(models.Select(entry => ReadUsage(entry.Value, true)).Aggregate(new ClaudeTokenUsage(), (sum, item) => sum.Add(item)));
                available |= models.Count > 0;
            }
            if (!available && (message["is_error"] is not JsonValue error || !error.TryGetValue<bool>(out var failed) || !failed))
                throw new ModelBudgetException("Model stopped: a completion lacked usage metadata.");
            usageObserved |= available;
            if (parent is null) { finalUsage = finalUsage.Max(usage); finalUsageObserved |= available; }
            else childResults[scope] = childResults.GetValueOrDefault(scope, new()).Max(usage);
            if (parent is null && message["total_cost_usd"] is JsonValue cost && cost.TryGetValue<decimal>(out var amount) && amount >= 0)
            { listCost = Math.Max(listCost, amount); listCostObserved = true; }
            if (message["modelUsage"] is JsonObject modelUsage)
                foreach (var model in modelUsage) Model(model.Key);
            Write(new JsonObject { ["event"] = "provider_result", ["scope"] = scope, ["usageAvailable"] = available, ["cumulativeUsage"] = available ? usage.Json() : null, ["totals"] = Totals.Json(), ["listEquivalentUsd"] = listCostObserved ? JsonValue.Create(listCost) : null });
        }
    }

    internal void Finish(string reason)
    {
        if (finished) return;
        finished = true;
        Write(new JsonObject
        {
            ["event"] = "stop", ["reason"] = reason, ["totals"] = Totals.Json(),
            ["listEquivalentUsd"] = listCostObserved ? JsonValue.Create(listCost) : null,
            ["provider"] = "claude", ["requestedModel"] = budget.UsageContext?.RequestedModel ?? "sonnet",
            ["actualModels"] = actualModels.Count == 0 ? null : new JsonArray(actualModels.Order().Select(model => (JsonNode?)JsonValue.Create(model)).ToArray()),
            ["runId"] = budget.UsageContext?.RunId, ["allocationId"] = budget.UsageContext?.AllocationId,
            ["workItemId"] = budget.UsageContext?.WorkItemId, ["mode"] = budget.UsageContext?.Mode,
            ["executionId"] = budget.UsageContext?.ExecutionId, ["pluginSourceHash"] = budget.UsageContext?.PluginSourceHash,
            ["durationMs"] = (long)Stopwatch.GetElapsedTime(started).TotalMilliseconds,
            ["processOutcome"] = reason is "completed" or "failed" or "waiting" or "cancelled" ? reason : "interrupted",
            ["usageState"] = finalUsageObserved ? "final_provider_metadata" : usageObserved ? "partial_observed" : "unavailable",
            ["measuredUsage"] = usageObserved ? Totals.Json() : null,
            ["submissionOutcome"] = "unknown; inspect canonical API receipts",
            ["automaticRetries"] = 0
        });
    }

    public void Dispose() => writer.Dispose();

    private void Write(JsonObject value)
    {
        value["timestamp"] = DateTimeOffset.UtcNow.ToString("O");
        var line = value.ToJsonString();
        var bytes = Encoding.UTF8.GetByteCount(line) + 1;
        if (!finished && (writtenEvents >= 5000 || writtenBytes + bytes > 2_000_000))
            throw new ModelBudgetException("Model stopped: metadata ledger reached its size bound.", "usage ledger limit reached");
        writtenEvents++; writtenBytes += bytes;
        writer.WriteLine(line);
    }

    private void Model(string? model)
    {
        if (model is null) return;
        if (model.Length is < 1 or > 120 || model.Any(c => !char.IsAsciiLetterOrDigit(c) && !"._:/-".Contains(c)) || actualModels.Count >= 16 && !actualModels.Contains(model))
            throw new ModelBudgetException("Model stopped: invalid provider model metadata.");
        actualModels.Add(model);
    }

    private static ClaudeTokenUsage ReadUsage(JsonNode? value, bool modelUsage) => new(
        Number(value, modelUsage ? "inputTokens" : "input_tokens"),
        Number(value, modelUsage ? "cacheCreationInputTokens" : "cache_creation_input_tokens"),
        Number(value, modelUsage ? "cacheReadInputTokens" : "cache_read_input_tokens"),
        Number(value, modelUsage ? "outputTokens" : "output_tokens"));

    private static long Number(JsonNode? value, string key)
    {
        if (value is JsonObject obj && obj[key] is JsonValue number && number.TryGetValue<long>(out var result) && result >= 0) return result;
        throw new ModelBudgetException("Model stopped: invalid provider usage metadata.");
    }

    private static string Hash(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
}
