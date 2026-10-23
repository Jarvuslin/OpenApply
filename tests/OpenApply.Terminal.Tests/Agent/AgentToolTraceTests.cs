using System.Text.Json;
using System.Text.Json.Nodes;
using OpenApply.Terminal.Agent;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed class AgentToolTraceTests
{
    [Fact]
    public void ClaudeKeepsDistinctBlocksSharingAMessageIdAndDeduplicatesActualInvocations()
    {
        var parser = new ClaudeProtocol();
        Assert.Empty(parser.Consume(Parse("""{"type":"assistant","uuid":"event-thinking","message":{"id":"message-shared","content":[{"type":"thinking","thinking":"private"}]}}""")));
        var review = Parse("""{"type":"assistant","uuid":"event-review","message":{"id":"message-shared","content":[{"type":"tool_use","id":"tool-review","name":"Agent","input":{"subagent_type":"resume-reviewer"}}]}}""");
        Assert.Equal("tool-review", Assert.Single(parser.Consume(review)).Metadata!.ToolInvocationId);
        var skill = Parse("""{"type":"assistant","uuid":"event-skill","message":{"id":"message-shared","content":[{"type":"tool_use","id":"tool-skill","name":"Skill","input":{"skill":"openapply:humanizer"}}]}}""");
        Assert.Equal("tool-skill", Assert.Single(parser.Consume(skill)).Metadata!.ToolInvocationId);
        Assert.Empty(parser.Consume(review));
        review["uuid"] = "event-replayed-with-new-envelope";
        Assert.Empty(parser.Consume(review));
        var results = parser.Consume(Parse("""{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tool-review","content":"private reviewer output"},{"type":"tool_result","tool_use_id":"tool-skill","content":"private skill output"}]}}"""));
        Assert.Equal(["tool-review", "tool-skill"], results.Select(entry => entry.Metadata!.ToolInvocationId));
        Assert.All(results, entry => Assert.Equal("completed", entry.Metadata!.ToolStatus));
    }

    [Fact]
    public void ClaudeRecordsSkillInvocationAndResultWithoutArgumentsOrOutput()
    {
        var parser = new ClaudeProtocol();
        var started = Assert.Single(parser.Consume(Parse("""{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_123","name":"Skill","input":{"skill":"openapply:humanizer","args":"private draft"}}]}}""")));
        Assert.Equal("openapply:humanizer", started.Metadata!.SkillName);
        Assert.Equal("toolu_123", started.Metadata.ToolInvocationId);
        Assert.Equal("started", started.Metadata.ToolStatus);
        Assert.Contains("openapply:humanizer", started.Content);
        var result = Parse("""{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_123","content":"private tool output"}]}}""");
        var completed = Assert.Single(parser.Consume(result));
        Assert.Equal(started.Metadata with { ToolStatus = "completed" }, completed.Metadata);
        Assert.Empty(parser.Consume(result));
        Assert.DoesNotContain("private", Wire(started) + Wire(completed));
    }

    [Fact]
    public void ClaudeRecordsSubagentTypeAndFailureWithoutTaskText()
    {
        var parser = new ClaudeProtocol();
        var started = Assert.Single(parser.Consume(Parse("""{"type":"assistant","message":{"content":[{"type":"tool_use","id":"review-1","name":"Agent","input":{"subagent_type":"resume-reviewer","description":"private title","prompt":"private task"}}]}}""")));
        Assert.Equal("resume-reviewer", started.Metadata!.SubagentType);
        var failed = Assert.Single(parser.Consume(Parse("""{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"review-1","is_error":true,"content":"private error"}]}}""")));
        Assert.Equal("failed", failed.Metadata!.ToolStatus);
        Assert.DoesNotContain("private", Wire(started) + Wire(failed));
    }

    [Fact]
    public void ClaudeDoesNotTreatUnmatchedResultsOrUnsafeNamesAsTraceEvidence()
    {
        var parser = new ClaudeProtocol();
        Assert.Empty(parser.Consume(Parse("""{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"unknown","content":"private"}]}}""")));
        var started = Assert.Single(parser.Consume(Parse("""{"type":"assistant","message":{"content":[{"type":"tool_use","id":"bad id","name":"Skill","input":{"skill":"private draft\nline"}}]}}""")));
        Assert.Null(started.Metadata!.ToolInvocationId);
        Assert.Null(started.Metadata.SkillName);
        Assert.DoesNotContain("private", Wire(started));
    }

    [Fact]
    public void ClaudeCanTraceChildSkillsWithoutPublishingChildText()
    {
        var parser = new ClaudeProtocol("parent");
        parser.Consume(Parse("""{"type":"system","subtype":"init","session_id":"parent"}"""));
        var started = Assert.Single(parser.Consume(Parse("""{"type":"assistant","session_id":"child","parent_tool_use_id":"review-1","message":{"content":[{"type":"text","text":"private child reasoning"},{"type":"tool_use","id":"child-skill","name":"Skill","input":{"skill":"openapply:humanizer"}}]}}""")));
        Assert.Equal("parent", started.SessionId);
        Assert.Equal("openapply:humanizer", started.Metadata!.SkillName);
        Assert.DoesNotContain("private", Wire(started));
    }

    [Theory]
    [InlineData("completed")]
    [InlineData("failed")]
    public void CodexPairsToolLifecycleWithoutPublishingCommandsOrResults(string status)
    {
        var parser = new CodexProtocol("/work", null, "Hi");
        parser.Consume(Parse("""{"id":2,"result":{"thread":{"id":"thread-one"}}}"""));
        var started = Assert.Single(parser.Consume(Parse("""{"method":"item/started","params":{"threadId":"thread-one","item":{"id":"command-1","type":"commandExecution","command":"private command"}}}""")).Events);
        Assert.Equal("command-1", started.Metadata!.ToolInvocationId);
        Assert.Null(started.Metadata.SkillName);
        var result = Parse("""{"method":"item/completed","params":{"threadId":"thread-one","item":{"id":"command-1","type":"commandExecution","aggregatedOutput":"private output"}}}""");
        result["params"]!["item"]!["status"] = status;
        var completed = Assert.Single(parser.Consume(result).Events);
        Assert.Equal(started.Metadata with { ToolStatus = status }, completed.Metadata);
        Assert.Empty(parser.Consume(result).Events);
        Assert.DoesNotContain("private", Wire(started) + Wire(completed));
    }

    [Fact]
    public void CodexDoesNotInventToolCompletionWithoutStatus()
    {
        var parser = new CodexProtocol("/work", null, "Hi");
        parser.Consume(Parse("""{"method":"item/started","params":{"item":{"id":"tool-1","type":"mcpToolCall","tool":"browser_snapshot"}}}"""));
        Assert.Empty(parser.Consume(Parse("""{"method":"item/completed","params":{"item":{"id":"tool-1","type":"mcpToolCall","result":"private"}}}""")).Events);
    }

    private static string Wire(AgentEvent entry) => JsonSerializer.Serialize(
        new WorkEvent("lease", "event", entry.Kind, entry.Content, entry.SessionId, entry.Metadata), AppJsonContext.Default.WorkEvent);

    private static JsonObject Parse(string value) => JsonNode.Parse(value)!.AsObject();
}
