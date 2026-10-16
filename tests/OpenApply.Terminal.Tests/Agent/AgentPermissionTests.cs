using System.Text.Json.Nodes;
using OpenApply.Terminal.Agent;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed class AgentPermissionTests
{
    [Fact]
    public void ClaudeReportsExpiredDenialOnceAndAcceptsAuthoritativeCompletion()
    {
        var parser = new ClaudeProtocol();
        var denied = parser.Consume(Parse("""{"type":"system","subtype":"permission_denied"}"""));
        Assert.Equal("error", Assert.Single(denied).Kind);
        var final = parser.Consume(Parse("""{"type":"result","is_error":false,"result":"Saved the previews. Optional scratch cleanup was denied.","permission_denials":[{"tool_name":"Bash","tool_input":{"command":"private cleanup arguments"}}]}"""));
        Assert.Equal("text", Assert.Single(final).Kind);
        Assert.DoesNotContain("private cleanup arguments", string.Join("", denied.Concat(final).Select(e => e.Content)));
        Assert.Equal("completed", parser.Result!.Status);
    }

    [Fact]
    public void ClaudePermissionNoticeDoesNotConvertFailureToSuccessOrWaiting()
    {
        var parser = new ClaudeProtocol();
        parser.Consume(Parse("""{"type":"system","subtype":"permission_denied"}"""));
        parser.Consume(Parse("""{"type":"result","is_error":true,"permission_denials":[{"tool_name":"Bash"}]}"""));
        Assert.Equal("failed", parser.Result!.Status);
        Assert.NotNull(parser.Result.Error);
    }

    [Fact]
    public void ClaudeUnansweredApplicantQuestionStillWaitsAfterOtherActionDenied()
    {
        var parser = new ClaudeProtocol();
        var question = parser.Consume(Parse("""{"type":"assistant","message":{"content":[{"type":"tool_use","name":"AskUserQuestion","input":{"questions":[{"question":"When can you start?"}]}}]}}"""));
        Assert.Equal("question", Assert.Single(question).Kind);
        parser.Consume(Parse("""{"type":"result","is_error":false,"permission_denials":[{"tool_name":"Bash"}]}"""));
        Assert.Equal("waiting", parser.Result!.Status);
    }

    [Fact]
    public void ClaudeEmptyQuestionDoesNotLeaveAnUnanswerableWaitingState()
    {
        var parser = new ClaudeProtocol();
        parser.Consume(Parse("""{"type":"assistant","message":{"content":[{"type":"tool_use","name":"AskUserQuestion","input":{"questions":[{"question":"   "}]}}]}}"""));
        parser.Consume(Parse("""{"type":"result","is_error":false}"""));
        Assert.Equal("completed", parser.Result!.Status);
    }

    [Theory]
    [InlineData("completed", "completed")]
    [InlineData("failed", "failed")]
    [InlineData("interrupted", "interrupted")]
    public void CodexDeniedPermissionsKeepTheAuthoritativeOutcome(string outcome, string expected)
    {
        var parser = StartCodex();
        var response = parser.Consume(Parse("""{"id":8,"method":"item/permissions/requestApproval","params":{"permissions":{"fileSystem":{"write":["private-path"]}}}}"""));
        Assert.Empty(Assert.Single(response.Replies)["result"]!["permissions"]!.AsObject());
        Assert.Equal("turn", response.Replies[0]["result"]!["scope"]!.GetValue<string>());
        Assert.Equal("error", Assert.Single(response.Events).Kind);
        Assert.DoesNotContain("private-path", response.Events[0].Content);
        FinishCodex(parser, outcome);
        Assert.Equal(expected, parser.Result!.Status);
    }

    [Fact]
    public void CodexRequiredQuestionStillWaitsAndDoesNotFabricateAnAnswer()
    {
        var parser = StartCodex();
        var response = parser.Consume(Parse("""{"id":9,"method":"item/tool/requestUserInput","params":{"questions":[{"question":"Do you need sponsorship?"}]}}"""));
        Assert.Equal("question", Assert.Single(response.Events).Kind);
        Assert.Empty(Assert.Single(response.Replies)["result"]!["answers"]!.AsObject());
        FinishCodex(parser, "completed");
        Assert.Equal("waiting", parser.Result!.Status);
    }

    [Fact]
    public void CodexUnknownClientInteractionIsRejectedWithoutInventingAQuestion()
    {
        var parser = StartCodex();
        var response = parser.Consume(Parse("""{"id":10,"method":"unsupported/action","params":{}}"""));
        Assert.Equal(-32601, Assert.Single(response.Replies)["error"]!["code"]!.GetValue<int>());
        Assert.Equal("error", Assert.Single(response.Events).Kind);
        FinishCodex(parser, "completed");
        Assert.Equal("completed", parser.Result!.Status);
    }

    private static CodexProtocol StartCodex()
    {
        var parser = new CodexProtocol("/work", null, "Preview only");
        parser.Consume(Parse("""{"id":2,"result":{"thread":{"id":"thread-one"}}}"""));
        parser.Consume(Parse("""{"id":3,"result":{"turn":{"id":"turn-one"}}}"""));
        return parser;
    }

    private static void FinishCodex(CodexProtocol parser, string status) => parser.Consume(new JsonObject
    {
        ["method"] = "turn/completed",
        ["params"] = new JsonObject { ["threadId"] = "thread-one", ["turn"] = new JsonObject { ["id"] = "turn-one", ["status"] = status } },
    });

    private static JsonObject Parse(string value) => JsonNode.Parse(value)!.AsObject();
}
