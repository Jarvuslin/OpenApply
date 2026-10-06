using System.Text.Json;
using System.Text.Json.Nodes;
using OpenApply.Terminal.Connectors;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed class GmailThreadSearchTests
{
    private const string Search = "mcp__claude_ai_Gmail__search_threads";
    private const string ReadAccess = "{\"structured_output\":{\"status\":\"ready\",\"reason\":\"read_access\"}}";

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"threads\":[]}")]
    [InlineData("{\"content\":[{\"type\":\"text\",\"text\":\"{}\"}]}")]
    [InlineData("{\"structuredContent\":{}}")]
    public void ObservedThreadSearchVerifiesReadAccessWithoutClaimingMailboxIdentity(string response)
    {
        var state = DeclaredMailbox();
        using var search = Hook("PreToolUse", Input());
        Assert.True(GmailToolGate.Allow(search.RootElement, state));
        Assert.False(GmailToolGate.Allow(search.RootElement, state));
        using var result = Hook("PostToolUse", Input(), response);
        Assert.True(GmailToolGate.Observe(result.RootElement, state));
        var check = GmailCheckProtocol.Result(ReadAccess, state);
        Assert.Equal("read_access", check.Status);
        Assert.Equal("confirm_mailbox", check.Action);
        Assert.Null(check.Mailbox);
        Assert.Null(state.Mailbox);
        Assert.False(state.ProfileSucceeded);
    }

    [Theory]
    [InlineData("{\"isError\":true}")]
    [InlineData("{\"error\":\"unauthorized\"}")]
    [InlineData("{\"ok\":true}")]
    [InlineData("{\"unknown\":{}}")]
    public void FailureAndUnknownResponsesDoNotAttestReadAccess(string response)
    {
        var state = DeclaredMailbox();
        using var search = Hook("PreToolUse", Input());
        Assert.True(GmailToolGate.Allow(search.RootElement, state));
        using var result = Hook("PostToolUse", Input(), response);
        Assert.False(GmailToolGate.Observe(result.RootElement, state));
        Assert.NotEqual("read_access", GmailCheckProtocol.Result(ReadAccess, state).Status);
    }

    [Fact]
    public void ReadAccessClaimNeedsAnObservedSearchAndDeclaredEmail()
    {
        Assert.NotEqual("read_access", GmailCheckProtocol.Result(ReadAccess, DeclaredMailbox()).Status);
        Assert.NotEqual("read_access", GmailCheckProtocol.Result(ReadAccess, new() { SearchSucceeded = true, SearchMode = "declared_mailbox", SearchCall = "s1" }).Status);
        Assert.NotEqual("connected", GmailCheckProtocol.Result("{\"structured_output\":{\"status\":\"ready\",\"reason\":\"ready\"}}",
            new() { ExpectedEmail = "person@example.com", SearchSucceeded = true, SearchMode = "declared_mailbox", SearchCall = "s1" }).Status);
    }

    [Fact]
    public void ThreadSearchEnforcesAddressScopeOneResultAndMetadataView()
    {
        foreach (var input in new[]
        {
            Input().Replace("deliveredto:", "to:", StringComparison.Ordinal),
            Input().Replace("person@example.com", "other@example.com", StringComparison.Ordinal),
            Input().Replace("\"pageSize\":1", "\"pageSize\":20", StringComparison.Ordinal),
            Input().Replace("THREAD_VIEW_METADATA_ONLY", "THREAD_VIEW_MINIMAL", StringComparison.Ordinal),
            Input()[..^1] + ",\"pageToken\":\"next\"}",
            Input()[..^1] + ",\"includeTrash\":true}",
        })
        {
            using var search = Hook("PreToolUse", input);
            Assert.False(GmailToolGate.Allow(search.RootElement, DeclaredMailbox()));
        }
    }

    [Fact]
    public void AvailableProfileOrMissingEmailPreventsTheIdentityLimitedPath()
    {
        using var search = Hook("PreToolUse", Input());
        Assert.False(GmailToolGate.Allow(search.RootElement, new() { GmailToolsDiscovered = true }));
        var profileAvailable = DeclaredMailbox();
        profileAvailable.ProfileToolDiscovered = true;
        Assert.False(GmailToolGate.Allow(search.RootElement, profileAvailable));
        var profileAttempted = DeclaredMailbox();
        profileAttempted.ProfileCall = "p1";
        Assert.False(GmailToolGate.Allow(search.RootElement, profileAttempted));
    }

    [Fact]
    public void ProfileVerifiedAccountCanUseTheActualThreadSearchSchema()
    {
        var state = new GmailCheckEvidence { ExpectedEmail = "person@example.com", Mailbox = "person@example.com", ProfileSucceeded = true, ProfileCall = "p1" };
        var input = new JsonObject { ["query"] = GmailCheckProtocol.SearchQuery, ["pageSize"] = 1, ["view"] = "THREAD_VIEW_METADATA_ONLY" }.ToJsonString();
        using var search = Hook("PreToolUse", input);
        Assert.True(GmailToolGate.Allow(search.RootElement, state));
        using var result = Hook("PostToolUse", input, "{}");
        Assert.True(GmailToolGate.Observe(result.RootElement, state));
        Assert.Equal("connected", GmailCheckProtocol.Result("{\"structured_output\":{\"status\":\"ready\",\"reason\":\"ready\"}}", state).Status);
    }

    private static GmailCheckEvidence DeclaredMailbox() => new() { ExpectedEmail = "person@example.com", GmailToolsDiscovered = true };
    private static string Input() => new JsonObject { ["query"] = GmailCheckProtocol.DeclaredMailboxQuery("person@example.com"), ["pageSize"] = 1, ["view"] = "THREAD_VIEW_METADATA_ONLY" }.ToJsonString();
    private static JsonDocument Hook(string stage, string input, string? response = null) => JsonDocument.Parse(new JsonObject
    {
        ["hook_event_name"] = stage, ["tool_name"] = Search, ["tool_use_id"] = "s1",
        ["tool_input"] = JsonNode.Parse(input), ["tool_response"] = response is null ? null : JsonNode.Parse(response),
    }.ToJsonString());
}
