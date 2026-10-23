using System.Text.Json.Nodes;
using OpenApply.Terminal.Agent;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed class ClaudeUsageLedgerTests
{
    [Fact]
    public void ParentAndChildUsageDeduplicatesRequestsBlocksAndCumulativeResults()
    {
        using var temp = new TempDir();
        var path = Path.Combine(temp.Root, "usage.jsonl");
        var budget = ModelBudgetTests.Budget(path);
        budget.BoundedAgentTypes.Add("openapply:job-worker");
        using var ledger = new ClaudeUsageLedger(budget);
        var parent = Parse("""{"type":"assistant","requestId":"req-parent","message":{"id":"msg-parent","usage":{"input_tokens":2,"cache_creation_input_tokens":10,"cache_read_input_tokens":100,"output_tokens":1},"content":[{"type":"tool_use","id":"tool-child","name":"Agent","input":{"subagent_type":"openapply:job-worker","prompt":"private-prompt"}}]}}""");
        ledger.Observe(parent);
        ledger.Observe(parent);
        parent["message"]!["usage"]!["output_tokens"] = 20L;
        ledger.Observe(parent);
        ledger.Observe(Parse("""{"type":"assistant","parent_tool_use_id":"tool-child","requestId":"req-child","message":{"id":"msg-child","usage":{"input_tokens":3,"cache_creation_input_tokens":20,"cache_read_input_tokens":200,"output_tokens":30},"content":[{"type":"text","text":"private-response"}]}}"""));
        var total = ledger.Totals;
        Assert.Equal(2, total.Requests);
        Assert.Equal(new ClaudeTokenUsage(5, 30, 300, 50), total.Tokens);
        Assert.Equal(1, total.Subagents);
        var result = Parse("""{"type":"result","result":"private-final","usage":{"input_tokens":5,"cache_creation_input_tokens":30,"cache_read_input_tokens":300,"output_tokens":50},"total_cost_usd":0.42} """);
        ledger.Observe(result);
        ledger.Observe(result);
        Assert.Equal(total, ledger.Totals);
        ledger.Finish("completed");
        ledger.Dispose();
        var text = File.ReadAllText(path);
        Assert.DoesNotContain("private", text);
        Assert.DoesNotContain("req-parent", text);
        Assert.DoesNotContain("tool-child", text);
        Assert.Contains("0.42", text);
    }

    [Fact]
    public void ChildResultRaisesIncompleteOutputAndParentModelUsageIsOnlyCumulativeFloor()
    {
        using var temp = new TempDir();
        using var ledger = new ClaudeUsageLedger(ModelBudgetTests.Budget(Path.Combine(temp.Root, "usage.jsonl")));
        ledger.Observe(Parse("""{"type":"assistant","parent_tool_use_id":"child","message":{"id":"child-one","usage":{"input_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":1}}} """));
        ledger.Observe(Parse("""{"type":"result","parent_tool_use_id":"child","usage":{"input_tokens":10,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":100}} """));
        ledger.Observe(Parse("""{"type":"result","modelUsage":{"model-name":{"inputTokens":20,"outputTokens":110,"cacheCreationInputTokens":0,"cacheReadInputTokens":300}}} """));
        Assert.Equal(new ClaudeTokenUsage(20, 0, 300, 110), ledger.Totals.Tokens);
        Assert.Equal(1, ledger.Totals.Requests);
    }

    [Fact]
    public void LedgerCannotBeReusedAndMalformedUsageFailsClosed()
    {
        using var temp = new TempDir();
        var budget = ModelBudgetTests.Budget(Path.Combine(temp.Root, "usage.jsonl"));
        using var ledger = new ClaudeUsageLedger(budget);
        Assert.Throws<IOException>(() => new ClaudeUsageLedger(budget));
        Assert.Throws<ModelBudgetException>(() => ledger.Observe(Parse("""{"type":"assistant","message":{"usage":{"input_tokens":10}}} """)));
        Assert.Throws<ModelBudgetException>(() => ledger.Observe(Parse("""{"type":"assistant","message":{"id":"message-one","usage":{"input_tokens":-1}}} """)));
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"input_tokens\":0,\"output_tokens\":1}")]
    [InlineData("{\"input_tokens\":0,\"output_tokens\":1,\"cache_creation_input_tokens\":0}")]
    [InlineData("{\"input_tokens\":0,\"output_tokens\":1,\"cache_creation_input_tokens\":0,\"cache_read_input_tokens\":null}")]
    public void MissingCountersAreUnknownRatherThanZero(string usage)
    {
        using var temp = new TempDir();
        using var ledger = new ClaudeUsageLedger(ModelBudgetTests.Budget(Path.Combine(temp.Root, "usage.jsonl")));
        var message = Parse("""{"type":"assistant","message":{"id":"msg-one"}}""");
        message["message"]!["usage"] = JsonNode.Parse(usage);
        Assert.Throws<ModelBudgetException>(() => ledger.Observe(message));
        Assert.Throws<ModelBudgetException>(() => ledger.Observe(Parse("""{"type":"result","modelUsage":{"model":{"inputTokens":0}}}""")));
    }

    [Fact]
    public void ErrorResultWithoutUsageRecordsUnknownConsumption()
    {
        using var temp = new TempDir();
        var path = Path.Combine(temp.Root, "usage.jsonl");
        using (var ledger = new ClaudeUsageLedger(ModelBudgetTests.Budget(path)))
        {
            ledger.Observe(Parse("""{"type":"result","is_error":true}"""));
            Assert.Throws<ModelBudgetException>(() => ledger.Observe(Parse("""{"type":"result","is_error":false}""")));
        }
        Assert.Contains("\"usageAvailable\":false", File.ReadAllText(path));
        Assert.Contains("\"cumulativeUsage\":null", File.ReadAllText(path));
    }

    [Theory]
    [InlineData("\"opus\"")]
    [InlineData("\"haiku\"")]
    [InlineData("17")]
    [InlineData("{}")]
    public void CappedWorkerCannotOverrideTheApprovedModel(string model)
    {
        using var temp = new TempDir();
        var budget = ModelBudgetTests.Budget(Path.Combine(temp.Root, "usage.jsonl"));
        budget.BoundedAgentTypes.Add("openapply:job-worker");
        using var ledger = new ClaudeUsageLedger(budget);
        var message = Parse("""{"type":"assistant","message":{"id":"msg-one","usage":{"input_tokens":1,"output_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":0},"content":[{"type":"tool_use","name":"Agent","id":"child","input":{"subagent_type":"openapply:job-worker"}}]}}""");
        message["message"]!["content"]![0]!["input"]!["model"] = JsonNode.Parse(model);
        var error = Assert.Throws<ModelBudgetException>(() => ledger.Observe(message));
        Assert.Equal("unapproved subagent model requested", error.Code);
        Assert.Equal(1, ledger.Totals.Subagents);
    }

    [Theory]
    [InlineData("sonnet")]
    [InlineData("inherit")]
    public void CappedWorkerCanRetainApprovedModel(string model)
    {
        var budget = ModelBudgetTests.Budget("unused");
        budget.BoundedAgentTypes.Add("openapply:job-worker");
        budget.ValidateSubagent("openapply:job-worker", JsonValue.Create(model));
        budget.ValidateSubagent("openapply:job-worker");
    }

    private static JsonObject Parse(string value) => JsonNode.Parse(value)!.AsObject();

    [Fact]
    public void SummarySeparatesRequestedModelMeasuredModelScopeAndUnknownSubmissionOutcome()
    {
        using var temp = new TempDir();
        var path = Path.Combine(temp.Root, "usage.jsonl");
        var context = new ModelUsageContext(Guid.NewGuid().ToString(), Guid.NewGuid().ToString(), Guid.NewGuid().ToString(), "queue-application", "sonnet");
        using (var ledger = new ClaudeUsageLedger(ModelBudgetTests.Budget(path) with { UsageContext = context }))
        {
            ledger.Observe(Parse("""{"type":"assistant","message":{"id":"one","model":"claude-sonnet-fixture","usage":{"input_tokens":2,"cache_creation_input_tokens":3,"cache_read_input_tokens":4,"output_tokens":5},"content":[{"type":"text","text":"private response"}]}}"""));
            ledger.Finish("cancelled");
        }
        var summary = Parse(File.ReadAllLines(path)[^1]);
        Assert.Equal(context.AllocationId, summary["allocationId"]!.GetValue<string>());
        Assert.Equal(context.WorkItemId, summary["workItemId"]!.GetValue<string>());
        Assert.Equal("sonnet", summary["requestedModel"]!.GetValue<string>());
        Assert.Equal("claude-sonnet-fixture", summary["actualModels"]![0]!.GetValue<string>());
        Assert.Equal("partial_observed", summary["usageState"]!.GetValue<string>());
        Assert.Equal(14, summary["measuredUsage"]!["totalTokenOccurrences"]!.GetValue<int>());
        Assert.True(summary["durationMs"]!.GetValue<long>() >= 0);
        Assert.Null(summary["listEquivalentUsd"]);
        Assert.Contains("unknown", summary["submissionOutcome"]!.GetValue<string>());
        Assert.DoesNotContain("private", File.ReadAllText(path));
    }

    [Fact]
    public void EmptySummaryReportsUnavailableRatherThanZeroConsumption()
    {
        using var temp = new TempDir();
        var path = Path.Combine(temp.Root, "usage.jsonl");
        using (var ledger = new ClaudeUsageLedger(ModelBudgetTests.Budget(path))) ledger.Finish("process_exception");
        var summary = Parse(File.ReadAllLines(path)[^1]);
        Assert.Equal("unavailable", summary["usageState"]!.GetValue<string>());
        Assert.Null(summary["measuredUsage"]);
        Assert.Null(summary["actualModels"]);
        Assert.Null(summary["mode"]);
    }

    [Fact]
    public void RepeatedToolBlocksCannotGrowMetadataLogWithoutBound()
    {
        using var temp = new TempDir();
        var path = Path.Combine(temp.Root, "usage.jsonl");
        using (var ledger = new ClaudeUsageLedger(ModelBudgetTests.Budget(path)))
        {
            var response = Parse("""{"type":"assistant","message":{"id":"one","usage":{"input_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":1}}}""");
            Assert.Throws<ModelBudgetException>(() => { for (var index = 0; index < 10000; index++) ledger.Observe(response); });
            Assert.Equal(1, ledger.Totals.Requests);
            ledger.Finish("usage ledger limit reached");
        }
        Assert.True(new FileInfo(path).Length < 2_010_000);
        Assert.Equal("stop", Parse(File.ReadAllLines(path)[^1])["event"]!.GetValue<string>());
    }
}
