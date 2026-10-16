using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging.Abstractions;
using OpenApply.Terminal.Agent;
using OpenApply.Terminal.Providers;
using OpenApply.Terminal.Queue;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed class AgentProtocolTests
{
    [Fact]
    public void ClaudeOnlyPublishesHumanTextAndToolNames()
    {
        var parser = new ClaudeProtocol();
        var init = parser.Consume(Parse("""{"type":"system","subtype":"init","session_id":"session-one"}"""));
        Assert.Equal("session-one", Assert.Single(init).SessionId);
        var events = parser.Consume(Parse("""{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"private reasoning"},{"type":"text","text":"Checking saved answers."},{"type":"tool_use","name":"Bash","input":{"command":"secret-password"}}]}}"""));
        Assert.Equal(["text", "activity"], events.Select(e => e.Kind));
        Assert.DoesNotContain("secret-password", string.Join("", events.Select(e => e.Content)));
        Assert.DoesNotContain("private reasoning", string.Join("", events.Select(e => e.Content)));
        Assert.Null(parser.Result);
        Assert.Empty(parser.Consume(Parse("""{"type":"result","is_error":false,"result":"Checking saved answers."}""")));
        Assert.Equal("completed", parser.Result!.Status);
    }

    [Fact]
    public void ClaudePermissionDenialIsVisibleWithoutInventingAnUnansweredQuestion()
    {
        var parser = new ClaudeProtocol();
        var events = parser.Consume(Parse("""{"type":"result","is_error":false,"permission_denials":[{"tool_name":"Bash","tool_input":{"command":"secret"}}]}"""));
        Assert.Equal("error", Assert.Single(events).Kind);
        Assert.DoesNotContain("secret", events[0].Content);
        Assert.Equal("completed", parser.Result!.Status);
    }

    [Fact]
    public void ClaudeMultiBlockFinalIsPublishedOnlyOnceAndChildTextStaysPrivate()
    {
        var parser = new ClaudeProtocol();
        Assert.Empty(parser.Consume(Parse("""{"type":"assistant","parent_tool_use_id":"worker","message":{"id":"child","content":[{"type":"text","text":"worker internals"}]}}""")));
        var message = Parse("""{"type":"assistant","message":{"id":"main","content":[{"type":"text","text":"First paragraph."},{"type":"text","text":"Second paragraph."}]}}""");
        Assert.Equal("First paragraph.\n\nSecond paragraph.", Assert.Single(parser.Consume(message)).Content);
        Assert.Empty(parser.Consume(message));
        Assert.Empty(parser.Consume(Parse("""{"type":"result","is_error":false,"result":"First paragraph.\nSecond paragraph."}""")));
    }

    [Fact]
    public void InvalidClaudeCompletionAndDifferentResumeSessionFailClosed()
    {
        var parser = new ClaudeProtocol("expected-session");
        Assert.Throws<InvalidDataException>(() => parser.Consume(Parse("""{"type":"system","subtype":"init","session_id":"different-session"}""")));
        Assert.Throws<InvalidDataException>(() => parser.Consume(Parse("""{"type":"result","result":"Done"}""")));
        Assert.Null(parser.Result);
    }

    [Fact]
    public void ClaudeChildSessionCannotReplaceOrCompleteParentSession()
    {
        var parser = new ClaudeProtocol("parent-session");
        parser.Consume(Parse("""{"type":"system","subtype":"init","session_id":"parent-session"}"""));
        Assert.Empty(parser.Consume(Parse("""{"type":"result","is_error":false,"result":"child result","parent_tool_use_id":"worker","session_id":"child-session"}""")));
        Assert.Equal("parent-session", parser.SessionId);
        Assert.Null(parser.Result);
    }

    [Fact]
    public void ClaudeQuestionsAreReadableAndMarkWaiting()
    {
        var parser = new ClaudeProtocol();
        var events = parser.Consume(Parse("""{"type":"assistant","message":{"content":[{"type":"tool_use","name":"AskUserQuestion","input":{"questions":[{"question":"What is your availability?"}]}}]}}"""));
        Assert.Equal("What is your availability?", Assert.Single(events).Content);
        parser.Consume(Parse("""{"type":"result","is_error":false}"""));
        Assert.Equal("waiting", parser.Result!.Status);
    }

    [Fact]
    public void CodexContinuesExactSessionAndRetainsApprovalAndSandbox()
    {
        var parser = new CodexProtocol("D:/work", "thread-one", "Follow up");
        var (replies, _) = parser.Consume(Parse("""{"id":1,"result":{}}"""));
        Assert.Equal("thread/resume", replies[1]["method"]!.GetValue<string>());
        Assert.Equal("thread-one", replies[1]["params"]!["threadId"]!.GetValue<string>());
        Assert.Equal("on-request", replies[1]["params"]!["approvalPolicy"]!.GetValue<string>());
        Assert.Equal("workspace-write", replies[1]["params"]!["sandbox"]!.GetValue<string>());
        var started = parser.Consume(Parse("""{"id":2,"result":{"thread":{"id":"thread-one"}}}"""));
        Assert.Equal("turn/start", Assert.Single(started.Replies)["method"]!.GetValue<string>());
        Assert.Equal("thread-one", Assert.Single(started.Events).SessionId);
    }

    [Fact]
    public void CodexIgnoresReasoningAndRawToolArgumentsAndRejectsPermissions()
    {
        var parser = new CodexProtocol("/work", null, "Hi");
        StartTurn(parser);
        Assert.Empty(parser.Consume(Parse("""{"method":"item/completed","params":{"item":{"id":"x","type":"reasoning","summary":["private"]}}}""")).Events);
        var tool = parser.Consume(Parse("""{"method":"item/started","params":{"item":{"id":"y","type":"commandExecution","command":"secret"}}}"""));
        Assert.Equal("Using commandExecution.", Assert.Single(tool.Events).Content);
        var denied = parser.Consume(Parse("""{"method":"item/commandExecution/requestApproval","id":9,"params":{"command":"secret"}}"""));
        Assert.Equal("decline", Assert.Single(denied.Replies)["result"]!["decision"]!.GetValue<string>());
        Assert.DoesNotContain("secret", Assert.Single(denied.Events).Content);
        Assert.Equal("error", denied.Events[0].Kind);
        parser.Consume(Parse("""{"method":"turn/completed","params":{"threadId":"thread-one","turn":{"id":"turn-one","status":"completed"}}}"""));
        Assert.Equal("completed", parser.Result!.Status);
    }

    [Fact]
    public void CodexOnlyCompletesAfterAuthoritativeTurnEvent()
    {
        var parser = new CodexProtocol("/work", null, "Hi");
        StartTurn(parser);
        var line = Parse("""{"method":"item/completed","params":{"item":{"id":"a","type":"agentMessage","text":"Done."}}}""");
        Assert.Single(parser.Consume(line).Events);
        Assert.Empty(parser.Consume(line).Events);
        Assert.Null(parser.Result);
        parser.Consume(Parse("""{"method":"turn/completed","params":{"threadId":"thread-one","turn":{"id":"turn-one","status":"interrupted"}}}"""));
        Assert.Equal("interrupted", parser.Result!.Status);
    }

    [Fact]
    public void CodexIgnoresChildOrStaleCompletionsAndDeclinesChildPermissionRequests()
    {
        var parser = new CodexProtocol("/work", null, "Hi");
        StartTurn(parser);
        parser.Consume(Parse("""{"method":"turn/completed","params":{"threadId":"child-thread","turn":{"id":"turn-one","status":"completed"}}}"""));
        Assert.Null(parser.Result);
        parser.Consume(Parse("""{"method":"turn/completed","params":{"threadId":"thread-one","turn":{"id":"old-turn","status":"completed"}}}"""));
        Assert.Null(parser.Result);
        var denied = parser.Consume(Parse("""{"method":"item/commandExecution/requestApproval","id":91,"params":{"threadId":"child-thread","command":"private command"}}"""));
        Assert.Equal("decline", Assert.Single(denied.Replies)["result"]!["decision"]!.GetValue<string>());
        Assert.Single(denied.Events);
    }

    [Fact]
    public void CodexCannotSilentlyResumeAnotherSession()
    {
        var parser = new CodexProtocol("/work", "expected-thread", "Hi");
        Assert.Throws<InvalidDataException>(() => parser.Consume(Parse("""{"id":2,"result":{"thread":{"id":"unrelated-thread"}}}""")));
        Assert.Null(parser.Result);
    }

    [Fact]
    public void PromptCarriesTheRequestAndSubmissionSafeguards()
    {
        var prompt = AgentProcess.BuildPrompt(QueueApiTests.Request with { Prompt = "New request" });
        Assert.Contains("New request", prompt);
        Assert.Contains("submission-checkpoint", prompt);
    }

    [Fact]
    public void ClaudeArgsLoadPluginAndResumeWithoutBypassingPermissions()
    {
        using var temp = new TempDir();
        var args = AgentProcess.Arguments(Provider.Claude, temp.Root, "specific-session", NullLogger.Instance);
        Assert.Contains("--plugin-dir", args);
        Assert.Contains("auto", args);
        Assert.Contains("stream-json", args);
        Assert.Equal(["--resume", "specific-session"], args.TakeLast(2));
        Assert.DoesNotContain("--dangerously-skip-permissions", args);
        Assert.DoesNotContain("--continue", args);
    }

    [Fact]
    public void WireEventsOmitOptionalNullsAndRedactCredentials()
    {
        var cleaned = AgentRedaction.Clean("token-123 Password: secret123\nAuthorization: Bearer abc.def\napi_key=other", "token-123");
        Assert.DoesNotContain("secret123", cleaned);
        Assert.DoesNotContain("abc.def", cleaned);
        Assert.DoesNotContain("token-123", cleaned);
        Assert.DoesNotContain("other", cleaned);
        Assert.DoesNotContain("json-secret", AgentRedaction.Clean("{\"password\":\"json-secret\"}", ""));
        var json = JsonSerializer.Serialize(new WorkEvent("lease", "event", "activity", "Working"), AppJsonContext.Default.WorkEvent);
        Assert.DoesNotContain("providerSessionId", json);
        Assert.DoesNotContain("metadata", json);
    }

    [Theory]
    [InlineData("https://api.example.com", true)]
    [InlineData("http://localhost:4101", true)]
    [InlineData("http://127.0.0.1:4101", true)]
    [InlineData("http://public.example.com", false)]
    [InlineData("https://user:secret@api.example.com", false)]
    [InlineData("https://api.example.com?token=secret", false)]
    public void ServiceUrlsProtectBearerCredentials(string url, bool valid) => Assert.Equal(valid, QueueEndpoints.IsServiceUrl(url));

    private static JsonObject Parse(string value) => JsonNode.Parse(value)!.AsObject();

    private static void StartTurn(CodexProtocol parser)
    {
        parser.Consume(Parse("""{"id":2,"result":{"thread":{"id":"thread-one"}}}"""));
        parser.Consume(Parse("""{"id":3,"result":{"turn":{"id":"turn-one"}}}"""));
    }
}
