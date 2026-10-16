using System.Collections;
using System.Reflection;
using System.Text.Json.Nodes;
using OpenApply.Terminal.Agent;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed class ClaudeUsageRetentionTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void RejectedModelLabelRetainsValidNonzeroUsageWithoutDoubleCounting(bool final)
    {
        using var temp = new TempDir();
        var path = Path.Combine(temp.Root, "usage.jsonl");
        using (var ledger = new ClaudeUsageLedger(ModelBudgetTests.Budget(path)))
        {
            var message = JsonNode.Parse(final
                ? """{"type":"result","modelUsage":{"invalid private label":{"inputTokens":2,"cacheCreationInputTokens":3,"cacheReadInputTokens":4,"outputTokens":5}}}"""
                : """{"type":"assistant","message":{"id":"response-one","model":"invalid private label","usage":{"input_tokens":2,"cache_creation_input_tokens":3,"cache_read_input_tokens":4,"output_tokens":5}}}""")!.AsObject();
            Assert.Throws<ModelBudgetException>(() => ledger.Observe(message));
            Assert.Throws<ModelBudgetException>(() => ledger.Observe(message));
            Assert.Equal(new ClaudeTokenUsage(2, 3, 4, 5), ledger.Totals.Tokens);
            Assert.Equal(final ? 0 : 1, ledger.Totals.Requests);
            ledger.Finish("invalid usage metadata");
        }
        var summary = JsonNode.Parse(File.ReadAllLines(path)[^1])!;
        Assert.Equal(14, summary["measuredUsage"]!["totalTokenOccurrences"]!.GetValue<int>());
        Assert.Equal(final ? "final_provider_metadata" : "partial_observed", summary["usageState"]!.GetValue<string>());
        Assert.Null(summary["actualModels"]);
        Assert.DoesNotContain("invalid private label", File.ReadAllText(path));
    }

    [Fact]
    public void LongProviderIdentitiesRetainOnlyFixedSizeDigestsAndStillDeduplicate()
    {
        using var temp = new TempDir();
        var path = Path.Combine(temp.Root, "usage.jsonl");
        var budget = ModelBudgetTests.Budget(path);
        budget.BoundedAgentTypes.Add("openapply:job-worker");
        using (var ledger = new ClaudeUsageLedger(budget))
        {
            var message = JsonNode.Parse("""{"type":"assistant","message":{"usage":{"input_tokens":1,"cache_creation_input_tokens":2,"cache_read_input_tokens":3,"output_tokens":4},"content":[{"type":"tool_use","name":"Agent","input":{"subagent_type":"openapply:job-worker"}}]}}""")!.AsObject();
            message["requestId"] = "private-request-" + new string('r', 500_000);
            message["message"]!["id"] = "private-message-" + new string('m', 500_000);
            message["message"]!["content"]![0]!["id"] = "private-subagent-" + new string('s', 500_000);
            ledger.Observe(message);
            ledger.Observe(message);
            Assert.Equal(1, ledger.Totals.Requests);
            Assert.Equal(1, ledger.Totals.Subagents);
            Assert.Equal(10, ledger.Totals.TotalTokens);
            // Log redaction alone does not prove the long raw values are absent from retained memory.
            var aliases = (IDictionary)typeof(ClaudeUsageLedger).GetField("aliases", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(ledger)!;
            var agents = (IEnumerable<string>)typeof(ClaudeUsageLedger).GetField("subagents", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(ledger)!;
            Assert.All(aliases.Keys.Cast<string>(), identity => Assert.Equal(72, identity.Length));
            Assert.All(agents, identity => Assert.Equal(64, identity.Length));
            ledger.Finish("cancelled");
        }
        var text = File.ReadAllText(path);
        Assert.DoesNotContain("private-request", text);
        Assert.DoesNotContain("private-message", text);
        Assert.DoesNotContain("private-subagent", text);
        Assert.True(new FileInfo(path).Length < 5000);
    }
}
