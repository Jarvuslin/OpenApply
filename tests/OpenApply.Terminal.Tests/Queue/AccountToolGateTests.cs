using System.Text.Json;
using System.Text.Json.Nodes;
using OpenApply.Terminal.Queue;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed class AccountToolGateTests
{
    private static JsonObject Pre(string tool, JsonObject? input = null) => new()
    {
        ["hook_event_name"] = "PreToolUse", ["tool_name"] = tool, ["tool_use_id"] = Guid.NewGuid().ToString(), ["tool_input"] = input ?? new(),
    };
    private static JsonObject Post(string tool, JsonNode response) => new() { ["hook_event_name"] = "PostToolUse", ["tool_name"] = tool, ["tool_response"] = response };
    private static AccountToolState State() => new() { Snapshot = QueueAccountTests.Snapshot() };
    private static JsonObject Verification(AccountToolState state) => new()
    {
        ["email"] = state.Snapshot!.Email, ["tenantOrigin"] = state.Snapshot.TenantOrigin,
        ["requestedAt"] = DateTimeOffset.UtcNow.AddMinutes(-1).ToString("O"), ["senderDomains"] = new JsonArray("synthetic.example"),
    };
    private static void Confirm(AccountToolState state)
    {
        const string tool = "mcp__openapply_account__verification_context";
        Assert.True(AccountToolGate.Allow(Pre(tool), state));
        Assert.True(AccountToolGate.Observe(Post(tool, new JsonObject { ["verificationRequest"] = Verification(state),
            ["mailbox"] = new JsonObject { ["email"] = state.Snapshot!.Email, ["basis"] = "user_confirmed" } }), state));
    }
    private static JsonObject Search(AccountToolState state) => new() { ["query"] = AccountToolGate.Query(state.Verification!), ["pageSize"] = 10, ["view"] = "THREAD_VIEW_METADATA_ONLY" };

    [Fact]
    public void OnlyExactAccountToolsAreAllowedAndNoUnrestrictedBrowserOrShellIsInherited()
    {
        foreach (var tool in new[] { "Bash", "Read", "Write", "Agent", "Task", "Skill", "mcp__playwright__browser_run_code", "mcp__gmail__send_message", "mcp__claude_ai_Gmail__modify_message", "mcp__openapply_account__attach" })
            Assert.False(AccountToolGate.Allow(Pre(tool), State()));
        foreach (var operation in QueueRuntime.AccountOperations)
            Assert.True(AccountToolGate.Allow(Pre("mcp__openapply_account__" + operation), State()));
        Assert.True(AccountToolGate.Allow(Pre("ToolSearch", new() { ["query"] = "+openapply_account" }), State()));
        Assert.False(AccountToolGate.Allow(Pre("ToolSearch", new() { ["query"] = "browser shell" }), State()));
    }

    [Fact]
    public void AdditionalCloudConnectorsAndGmailToolsRemainDeniedAfterMailboxConfirmation()
    {
        foreach (var tool in new[] { "mcp__claude_ai_Slack__search", "mcp__claude_ai_Google_Drive__get_document",
            "mcp__claude_ai_Gmail__send_email", "mcp__claude_ai_Gmail__create_draft", "mcp__claude_ai_Gmail__get_thread",
            "mcp__claude_ai_Gmail__list_messages", "mcp__claude_ai_Gmail__search_threads_extra", "mcp__openapply_browser__snapshot" })
        {
            var state = State();
            Confirm(state);
            Assert.False(AccountToolGate.Allow(Pre(tool, new() { ["query"] = "synthetic" }), state));
            Assert.Null(state.PendingTool);
        }
    }

    [Fact]
    public void ConfirmedMailboxWithoutProfilePermitsOneBoundedSearchAndOnlyItsCandidateReads()
    {
        var state = State();
        Confirm(state);
        Assert.False(state.ProfileVerified);
        var invalid = Search(state); invalid["query"] = "all mail";
        Assert.False(AccountToolGate.Allow(Pre("mcp__claude_ai_Gmail__search_threads", invalid), state));
        Assert.True(AccountToolGate.Allow(Pre("mcp__claude_ai_Gmail__search_threads", Search(state)), state));
        Assert.True(AccountToolGate.Observe(Post("mcp__claude_ai_Gmail__search_threads", new JsonObject { ["messages"] = new JsonArray(new JsonObject { ["id"] = "message-1" }, new JsonObject { ["id"] = "message-2" }) }), state));
        Assert.False(AccountToolGate.Allow(Pre("mcp__claude_ai_Gmail__search_threads", Search(state)), state));
        Assert.False(AccountToolGate.Allow(Pre("mcp__claude_ai_Gmail__get_message", new() { ["messageId"] = "unrelated" }), state));
        Assert.False(AccountToolGate.Allow(Pre("mcp__claude_ai_Gmail__get_message", new() { ["messageId"] = "message-1", ["id"] = "unrelated" }), state));
        Assert.True(AccountToolGate.Allow(Pre("mcp__claude_ai_Gmail__get_message", new() { ["messageId"] = "message-1" }), state));
        Assert.True(AccountToolGate.Observe(Post("mcp__claude_ai_Gmail__get_message", new JsonObject { ["body"] = "synthetic secret not persisted 123456" }), state));
        Assert.False(AccountToolGate.Allow(Pre("mcp__claude_ai_Gmail__get_message", new() { ["messageId"] = "message-1" }), state));
        Assert.DoesNotContain("123456", JsonSerializer.Serialize(state, AppJsonContext.Default.AccountToolState));
    }

    [Fact]
    public void ThreadReadsAreLimitedToThreadsFromTheOneSearch()
    {
        var state = State();
        Confirm(state);
        Assert.True(AccountToolGate.Allow(Pre("mcp__claude_ai_Gmail__search_threads", Search(state)), state));
        Assert.True(AccountToolGate.Observe(Post("mcp__claude_ai_Gmail__search_threads", new JsonObject { ["threads"] = new JsonArray(new JsonObject { ["id"] = "thread-1" }) }), state));
        Assert.False(AccountToolGate.Allow(Pre("mcp__claude_ai_Gmail__get_thread", new() { ["threadId"] = "unrelated" }), state));
        Assert.False(AccountToolGate.Allow(Pre("mcp__claude_ai_Gmail__get_thread", new() { ["threadId"] = "thread-1", ["includeTrash"] = "true" }), state));
        Assert.True(AccountToolGate.Allow(Pre("mcp__claude_ai_Gmail__get_thread", new() { ["threadId"] = "thread-1", ["messageFormat"] = "PLAIN_TEXT" }), state));
        Assert.True(AccountToolGate.Observe(Post("mcp__claude_ai_Gmail__get_thread", new JsonObject { ["body"] = "synthetic" }), state));
        Assert.False(AccountToolGate.Allow(Pre("mcp__claude_ai_Gmail__get_thread", new() { ["threadId"] = "thread-1" }), state));
    }

    [Fact]
    public void AvailableProfileMismatchOrAuthorizationFailureStopsEvenWithConfirmation()
    {
        var state = State(); Confirm(state);
        Assert.True(AccountToolGate.Allow(Pre("mcp__claude_ai_Gmail__get_profile"), state));
        Assert.False(AccountToolGate.Observe(Post("mcp__claude_ai_Gmail__get_profile", new JsonObject { ["emailAddress"] = "other@example.test" }), state));
        Assert.True(state.Blocked);
        Assert.Equal("mismatch", state.MailboxFailure);
        Assert.Equal("other@example.test", state.ObservedMailbox);
        Assert.False(AccountToolGate.Allow(Pre("mcp__claude_ai_Gmail__search_threads", Search(state)), state));
        Assert.True(AccountToolGate.Allow(Pre("mcp__openapply_account__request_help", new() { ["reason"] = "mailbox_identity" }), state));
        var failed = State(); Confirm(failed);
        Assert.True(AccountToolGate.Allow(Pre("mcp__claude_ai_Gmail__search_threads", Search(failed)), failed));
        Assert.False(AccountToolGate.Observe(Post("mcp__claude_ai_Gmail__search_threads", new JsonObject { ["isError"] = true }), failed));
        Assert.Equal("authorization_failed", failed.MailboxFailure);
        Assert.False(AccountToolGate.Allow(Pre("mcp__openapply_account__verify", new() { ["code"] = "123456" }), failed));
    }

    [Fact]
    public void ProviderFailureEventClearsPendingCallAndAllowsOnlyHumanHelp()
    {
        var state = State(); Confirm(state);
        const string tool = "mcp__claude_ai_Gmail__search_threads";
        Assert.True(AccountToolGate.Allow(Pre(tool, Search(state)), state));
        Assert.False(AccountToolGate.Observe(new() { ["hook_event_name"] = "PostToolUseFailure", ["tool_name"] = tool, ["error"] = "synthetic rejected credential" }, state));
        Assert.Null(state.PendingTool);
        Assert.Equal("authorization_failed", state.MailboxFailure);
        Assert.True(state.Blocked);
        Assert.True(AccountToolGate.Allow(Pre("mcp__openapply_account__request_help", new() { ["reason"] = "mailbox_identity" }), state));
        Assert.DoesNotContain("synthetic rejected", JsonSerializer.Serialize(state, AppJsonContext.Default.AccountToolState));
    }

    [Fact]
    public void ProfileDiscoveredRequiresSuccessfulMatchingProfileAndTenantCannotChange()
    {
        var state = State(); Confirm(state);
        Assert.True(AccountToolGate.Allow(Pre("ToolSearch", new() { ["query"] = "gmail tools" }), state));
        Assert.True(AccountToolGate.Observe(Post("ToolSearch", new JsonObject { ["matches"] = new JsonArray("mcp__claude_ai_Gmail__get_profile") }), state));
        Assert.False(AccountToolGate.Allow(Pre("mcp__claude_ai_Gmail__search_threads", Search(state)), state));
        Assert.True(AccountToolGate.Allow(Pre("mcp__claude_ai_Gmail__get_profile"), state));
        Assert.True(AccountToolGate.Observe(Post("mcp__claude_ai_Gmail__get_profile", new JsonObject { ["emailAddress"] = state.Snapshot!.Email }), state));
        Assert.True(AccountToolGate.Allow(Pre("mcp__openapply_account__verification_context"), state));
        var wrong = Verification(state); wrong["tenantOrigin"] = "https://wrong.example";
        Assert.False(AccountToolGate.Observe(Post("mcp__openapply_account__verification_context", new JsonObject { ["verificationRequest"] = wrong }), state));
        Assert.True(state.Blocked);
    }
}
