using System.Text.Json;
using OpenApply.Terminal.Connectors;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed class GmailCheckTests
{
    private const string Ready = "{\"is_error\":false,\"structured_output\":{\"status\":\"ready\",\"reason\":\"ready\"}}";

    [Fact]
    public void BackgroundCheckKeepsSubscriptionConfigWithoutGivingTheModelLocalTools()
    {
        var args = GmailCheckProtocol.Arguments("settings.json");
        Assert.Contains("haiku", args);
        Assert.Equal("ToolSearch", args[Array.IndexOf(args, "--tools") + 1]);
        Assert.Equal("dontAsk", args[Array.IndexOf(args, "--permission-mode") + 1]);
        Assert.Equal("none", args[Array.IndexOf(args, "--permission-prompts") + 1]);
        Assert.Equal("user", args[Array.IndexOf(args, "--setting-sources") + 1]);
        Assert.Contains("--no-session-persistence", args);
        Assert.DoesNotContain("--bare", args);
        Assert.DoesNotContain("--strict-mcp-config", args);
        Assert.DoesNotContain("--plugin-dir", args);
        Assert.DoesNotContain("--dangerously-skip-permissions", args);
    }

    [Fact]
    public void HookPathsArePassedAsExecArgumentsWithoutShellInterpolation()
    {
        const string path = "C:/A spaced & special $folder/check.json";
        using var settings = JsonDocument.Parse(GmailCheckProtocol.Settings("C:/Host path/openapply.exe", [], path));
        var hooks = settings.RootElement.GetProperty("hooks");
        foreach (var stage in new[] { "PreToolUse", "PostToolUse" })
        {
            var hook = hooks.GetProperty(stage)[0].GetProperty("hooks")[0];
            Assert.Equal("C:/Host path/openapply.exe", hook.GetProperty("command").GetString());
            Assert.Equal(path, hook.GetProperty("args")[1].GetString());
            Assert.Equal("*", hooks.GetProperty(stage)[0].GetProperty("matcher").GetString());
        }
    }

    [Fact]
    public void ModelClaimAloneCannotConnectAndAnObservedEmptySearchCan()
    {
        Assert.Equal("needs_user", GmailCheckProtocol.Result(Ready, new()).Status);
        Assert.Equal("needs_user", GmailCheckProtocol.Result(Ready, new() { ProfileSucceeded = true, Mailbox = "person@example.com" }).Status);
        Assert.Equal("needs_user", GmailCheckProtocol.Result(Ready, new() { ProfileSucceeded = true, SearchSucceeded = true }).Status);
        var result = GmailCheckProtocol.Result(Ready, new() { ProfileSucceeded = true, SearchSucceeded = true, ProfileCall = "p1", SearchCall = "s1", Mailbox = "person@example.com" });
        Assert.Equal("connected", result.Status);
        Assert.Equal("person@example.com", result.Mailbox);
        Assert.Null(result.Action);
    }

    [Fact]
    public void WrongMailboxWinsEvenIfModelClaimsReady()
    {
        var result = GmailCheckProtocol.Result(Ready, new() { ExpectedEmail = "expected@example.com", Mailbox = "other@example.com", ProfileSucceeded = true });
        Assert.Equal("needs_user", result.Status);
        Assert.Equal("switch_account", result.Action);
        Assert.Equal("other@example.com", result.Mailbox);
    }

    [Theory]
    [InlineData("missing_connector", "not available", "connect_gmail")]
    [InlineData("permission", "permission was denied", "connect_gmail")]
    [InlineData("unsupported_tools", "not supported", "retry")]
    [InlineData("search_failed", "search did not complete", "retry")]
    [InlineData("ready", "required profile and search evidence", "retry")]
    public void MissingAccessAndCheckerCompatibilityHaveDifferentAdvice(string reason, string message, string action)
    {
        var output = "{\"structured_output\":{\"status\":\"needs_user\",\"reason\":\"" + reason + "\"}}";
        var result = GmailCheckProtocol.Result(output, new());
        Assert.Equal("needs_user", result.Status);
        Assert.Contains(message, result.Message);
        Assert.Equal(action, result.Action);
    }

    [Theory]
    [InlineData("permission", "permission")]
    [InlineData("unsupported_tools", "unsupported_tools")]
    [InlineData("private@example.com", "invalid_result")]
    public void DiagnosticReasonNeverLogsFreeText(string reason, string expected)
    {
        Assert.Equal(expected, GmailCheckEndpoints.SafeReason("{\"structured_output\":{\"reason\":\"" + reason + "\"}}"));
    }

    [Fact]
    public void ObservedGmailWithoutProfileToolCannotBeMisreportedAsDisconnected()
    {
        const string output = "{\"structured_output\":{\"status\":\"needs_user\",\"reason\":\"missing_connector\"}}";
        var result = GmailCheckProtocol.Result(output, new() { GmailToolsDiscovered = true });
        Assert.Equal("needs_user", result.Status);
        Assert.Equal("retry", result.Action);
        Assert.Contains("Gmail is available", result.Message);
        Assert.Contains("account-profile lookup", result.Message);
        Assert.Null(result.Mailbox);
    }

    [Fact]
    public void LocalGateDenialIsReportedAsCompatibilityNotGmailAuthorization()
    {
        const string output = "{\"structured_output\":{\"status\":\"needs_user\",\"reason\":\"permission\"}}";
        var result = GmailCheckProtocol.Result(output, new() { BlockedGmailTools = ["mcp__claude_ai_Gmail__search_threads"] });
        Assert.Equal("retry", result.Action);
        Assert.Contains("checker needs an update", result.Message);
    }

    [Theory]
    [InlineData("{\"structured_output\":{\"status\":\"ready\",\"reason\":\"ready\",\"mail\":\"unwanted message body\"}}")]
    [InlineData("{\"structured_output\":{\"status\":\"connected\",\"reason\":\"ready\"}}")]
    [InlineData("{\"result\":\"Gmail connected!\"}")]
    public void RejectsMalformedOrUnexpectedModelOutput(string output) => Assert.Throws<JsonException>(() => GmailCheckProtocol.Result(output, new()));

    [Theory]
    [InlineData(" Person@Example.com ", "person@example.com")]
    [InlineData("person+jobs@gmail.com", "person+jobs@gmail.com")]
    [InlineData("Name <person@example.com>", null)]
    [InlineData("person\n@example.com", null)]
    [InlineData("not an email", null)]
    public void ExpectedAddressIsNormalizedWithoutGuessingAliases(string input, string? expected) => Assert.Equal(expected, GmailCheckProtocol.NormalizeEmail(input));

    [Fact]
    public void AotCanReadAndWriteTheWebContractAndPrivateEvidence()
    {
        var request = new GmailCheckRequest("claude", "person@example.com");
        Assert.Equal(request, JsonSerializer.Deserialize(JsonSerializer.Serialize(request, AppJsonContext.Default.GmailCheckRequest), AppJsonContext.Default.GmailCheckRequest));
        var response = new GmailCheckResponse("codex", "needs_user", null, "Choose Claude", "switch_provider");
        Assert.Equal(response, JsonSerializer.Deserialize(JsonSerializer.Serialize(response, AppJsonContext.Default.GmailCheckResponse), AppJsonContext.Default.GmailCheckResponse));
        Assert.NotNull(JsonSerializer.Deserialize("{\"expectedEmail\":null}", AppJsonContext.Default.GmailCheckEvidence));
    }
}
