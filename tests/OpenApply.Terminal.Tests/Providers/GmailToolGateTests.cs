using System.Text.Json;
using System.Text.Json.Nodes;
using OpenApply.Terminal.Connectors;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed class GmailToolGateTests
{
    private const string Profile = "mcp__claude_ai_Gmail__gmail_get_profile";
    private const string Search = "mcp__claude_ai_Gmail__gmail_search_messages";

    [Fact]
    public void DiscoveryDiagnosticCannotReadProfileOrMail()
    {
        var state = new GmailCheckEvidence { DiscoveryOnly = true, ProfileSucceeded = true };
        using var profile = Hook("PreToolUse", Profile, "p1", "{}");
        using var search = Hook("PreToolUse", Search, "s1", Query());
        using var discover = Hook("PreToolUse", "ToolSearch", "d1", "{\"query\":\"gmail profile search\"}");
        Assert.False(GmailToolGate.Allow(profile.RootElement, state));
        Assert.False(GmailToolGate.Allow(search.RootElement, state));
        Assert.True(GmailToolGate.Allow(discover.RootElement, state));
        Assert.Null(state.ProfileCall);
        Assert.Null(state.SearchCall);
    }

    [Fact]
    public void DiscoveryMetadataIsRetainedOnlyForAnExplicitDiagnostic()
    {
        using var discover = Hook("PostToolUse", "ToolSearch", "d1", "{}", "{\"tools\":[{\"name\":\"gmail_get_profile\",\"input_schema\":{}}]}");
        var normal = new GmailCheckEvidence();
        Assert.True(GmailToolGate.Observe(discover.RootElement, normal));
        Assert.Null(normal.DiscoveryResponse);
        var diagnostic = new GmailCheckEvidence { DiscoveryOnly = true };
        Assert.True(GmailToolGate.Observe(discover.RootElement, diagnostic));
        Assert.NotNull(diagnostic.DiscoveryResponse);
        Assert.False(diagnostic.ProfileSucceeded);
        Assert.False(diagnostic.SearchSucceeded);
    }

    [Fact]
    public void ActualClaudeToolSearchShapeDistinguishesAvailableGmailFromAProfileTool()
    {
        using var discovery = Hook("PostToolUse", "ToolSearch", "d1", "{}",
            "{\"matches\":[\"mcp__claude_ai_Gmail__search_threads\",\"mcp__claude_ai_Gmail__get_message\",\"mcp__claude_ai_Gmail__get_thread\"],\"query\":\"gmail profile search\",\"total_deferred_tools\":83}");
        var state = new GmailCheckEvidence();
        Assert.True(GmailToolGate.Observe(discovery.RootElement, state));
        Assert.True(state.GmailToolsDiscovered);
        Assert.False(state.ProfileToolDiscovered);
        Assert.Null(state.DiscoveryResponse);
        Assert.Null(state.ProfileCall);
        Assert.Null(state.SearchCall);
    }

    [Theory]
    [InlineData("Bash")]
    [InlineData("Read")]
    [InlineData("Agent")]
    [InlineData("mcp__playwright__browser_navigate")]
    [InlineData("mcp__claude_ai_Gmail__gmail_send_message")]
    [InlineData("mcp__claude_ai_Gmail__gmail_create_draft")]
    [InlineData("mcp__claude_ai_Gmail__gmail_delete_message")]
    [InlineData("mcp__other__gmail_get_profile")]
    public void OnlyTheGmailCheckToolsAreAllowed(string name)
    {
        using var hook = Hook("PreToolUse", name, "call-1", "{}");
        Assert.False(GmailToolGate.Allow(hook.RootElement, new()));
    }

    [Fact]
    public void SearchRequiresObservedMatchingProfileAndEachCallRunsOnce()
    {
        var state = new GmailCheckEvidence { ExpectedEmail = "person@example.com" };
        using var search = Hook("PreToolUse", Search, "search-1", Query());
        Assert.False(GmailToolGate.Allow(search.RootElement, state));
        using var profile = Hook("PreToolUse", Profile, "profile-1", "{}");
        Assert.True(GmailToolGate.Allow(profile.RootElement, state));
        Assert.False(GmailToolGate.Allow(profile.RootElement, state));
        using var profileResult = Hook("PostToolUse", Profile, "profile-1", "{}", "{\"emailAddress\":\"Person@Example.com\"}");
        Assert.True(GmailToolGate.Observe(profileResult.RootElement, state));
        Assert.True(GmailToolGate.Allow(search.RootElement, state));
        Assert.False(GmailToolGate.Allow(search.RootElement, state));
        using var result = Hook("PostToolUse", Search, "search-1", Query(), "{\"messages\":[],\"resultSizeEstimate\":0}");
        Assert.True(GmailToolGate.Observe(result.RootElement, state));
        Assert.True(state.SearchSucceeded);
    }

    [Fact]
    public void WrongMailboxBlocksSearchWithoutEquatingAliases()
    {
        var state = new GmailCheckEvidence { ExpectedEmail = "person+jobs@gmail.com", ProfileCall = "profile-1" };
        using var result = Hook("PostToolUse", Profile, "profile-1", "{}", "{\"emailAddress\":\"person@gmail.com\"}");
        Assert.True(GmailToolGate.Observe(result.RootElement, state));
        using var search = Hook("PreToolUse", Search, "search-1", Query());
        Assert.False(GmailToolGate.Allow(search.RootElement, state));
    }

    [Theory]
    [InlineData("{\"query\":\"in:anywhere\",\"max_results\":1}")]
    [InlineData("{}")]
    [InlineData("{\"query\":\"newer_than:7d\",\"max_results\":1}")]
    public void ArbitraryOrUnboundedSearchIsDenied(string query)
    {
        using var search = Hook("PreToolUse", Search, "search-1", query);
        Assert.False(GmailToolGate.Allow(search.RootElement, new() { ProfileSucceeded = true, Mailbox = "person@example.com" }));
    }

    [Fact]
    public void SearchLimitAndMailboxSelectorAreEnforced()
    {
        foreach (var input in new[] { Query(100), Query().Replace("\"max_results\":1", "\"max_results\":\"one\""), Query()[..^1] + ",\"user_id\":\"other@example.com\"}" })
        {
            using var hook = Hook("PreToolUse", Search, "search-1", input);
            Assert.False(GmailToolGate.Allow(hook.RootElement, new() { ProfileSucceeded = true }));
        }
    }

    [Theory]
    [InlineData("{\"isError\":true,\"emailAddress\":\"person@example.com\"}")]
    [InlineData("{\"error\":\"unauthorized\",\"emailAddress\":\"person@example.com\"}")]
    [InlineData("{\"to\":\"person@example.com\"}")]
    [InlineData("{\"emailAddress\":\"one@example.com\",\"email\":\"two@example.com\"}")]
    public void UnverifiedProfilesCannotBecomeEvidence(string response)
    {
        using var result = Hook("PostToolUse", Profile, "profile-1", "{}", response);
        var state = new GmailCheckEvidence { ProfileCall = "profile-1" };
        Assert.False(GmailToolGate.Observe(result.RootElement, state));
        Assert.False(state.ProfileSucceeded);
    }

    [Fact]
    public void ProfileCanBeReadFromStructuredMcpContentButNotAnUnmatchedCall()
    {
        var response = new JsonObject { ["content"] = new JsonArray(new JsonObject { ["type"] = "text", ["text"] = "{\"emailAddress\":\"person@example.com\"}" }) }.ToJsonString();
        using var result = Hook("PostToolUse", Profile, "profile-1", "{}", response);
        Assert.False(GmailToolGate.Observe(result.RootElement, new() { ProfileCall = "other-call" }));
        var state = new GmailCheckEvidence { ProfileCall = "profile-1" };
        Assert.True(GmailToolGate.Observe(result.RootElement, state));
        Assert.Equal("person@example.com", state.Mailbox);
    }

    [Theory]
    [InlineData("{\"isError\":true,\"messages\":[]}")]
    [InlineData("{\"content\":[{\"type\":\"text\",\"text\":\"{\\\"error\\\":\\\"unauthorized\\\"}\"}]}")]
    [InlineData("{\"ok\":true}")]
    public void SearchFailureOrUnrecognizedResultDoesNotVerifyAccess(string response)
    {
        using var result = Hook("PostToolUse", Search, "search-1", Query(), response);
        var state = new GmailCheckEvidence { ProfileSucceeded = true, SearchCall = "search-1" };
        Assert.False(GmailToolGate.Observe(result.RootElement, state));
        Assert.False(state.SearchSucceeded);
    }

    [Fact]
    public async Task MalformedHookInputAndMissingStateFailClosed()
    {
        var output = new StringWriter();
        Assert.Equal(2, await GmailToolGate.RunAsync("missing-gmail-check-state", "pre", new StringReader("not json"), output));
        Assert.Contains("\"permissionDecision\":\"deny\"", output.ToString());
        output.GetStringBuilder().Clear();
        Assert.Equal(2, await GmailToolGate.RunAsync("missing-gmail-check-state", "pre", new StringReader("{}"), output));
        Assert.Contains("\"permissionDecision\":\"deny\"", output.ToString());
    }

    private static string Query(int limit = 1) => new JsonObject { ["query"] = GmailCheckProtocol.SearchQuery, ["max_results"] = limit }.ToJsonString();

    private static JsonDocument Hook(string stage, string name, string id, string input, string? response = null) => JsonDocument.Parse(new JsonObject
    {
        ["hook_event_name"] = stage, ["tool_name"] = name, ["tool_use_id"] = id,
        ["tool_input"] = JsonNode.Parse(input), ["tool_response"] = response is null ? null : JsonNode.Parse(response),
    }.ToJsonString());
}
