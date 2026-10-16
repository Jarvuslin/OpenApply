using System.Diagnostics;
using System.Text.Json;
using OpenApply.Terminal.Agent;
using OpenApply.Terminal.Hosting;
using OpenApply.Terminal.Queue;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed partial class QueuePoolTests
{
    [Fact]
    public async Task ExplicitAccountLaunchReauthenticatesAndRejectsChangedSnapshotOrDuplicateApproval()
    {
        using var test = new Pool(account: true, configureGrant: false);
        await test.Runtime.ConnectAsync(new(QueueApiTests.Connection.ApiToken, QueueApiTests.Connection.ApiUrl, QueueApiTests.Connection.WebUrl), TestContext.Current.CancellationToken);
        var status = test.Runtime.Status;
        var input = new AccountLaunchRequest(status.OwnerId!, status.ConnectionId!, test.Api.Account!, new(12, 120000, 0, 12, 12, 2, 180), "synthetic-explicit-approval", true);
        await Assert.ThrowsAsync<InvalidOperationException>(() => test.Runtime.LaunchAccountAsync(input with { Snapshot = input.Snapshot with { SnapshotHash = new('c', 64) } }, "user-token", TestContext.Current.CancellationToken));
        var launched = await test.Runtime.LaunchAccountAsync(input, "user-token", TestContext.Current.CancellationToken);
        Assert.Equal(1, launched.Budget!.RemainingAllocations);
        await Assert.ThrowsAsync<InvalidOperationException>(() => test.Runtime.LaunchAccountAsync(input with { ApprovalReference = "another-explicit-approval" }, "user-token", TestContext.Current.CancellationToken));
        Assert.Empty(test.Process.Started);
        Assert.Equal(0, test.Api.Claims);
    }
}

public sealed class AccountProcessSettingsTests
{
    [Fact]
    public void AccountProviderHasNoOrdinaryTokenPluginShellSessionOrApplicationBrowser()
    {
        using var temp = new TempDir();
        temp.WriteValidPluginTree();
        var plugin = Path.Combine(temp.Root, "plugin");
        Directory.CreateDirectory(Path.Combine(plugin, "bin"));
        File.WriteAllText(Path.Combine(plugin, "bin", "account-mcp.mjs"), "// synthetic configuration test only");
        var workspace = Path.Combine(temp.Root, Guid.NewGuid().ToString());
        Directory.CreateDirectory(workspace);
        var snapshot = QueueAccountTests.Snapshot();
        var browser = new QueueBrowserSession(workspace, "http://localhost:4102", (_, _) => throw new NotImplementedException(), () => Task.CompletedTask);
        var claim = new AgentRequest(snapshot.WorkItemId, Guid.NewGuid().ToString(), "claude", "unused", "unused", null, Browser: browser, AccountSetup: snapshot);
        var start = new ProcessStartInfo("synthetic-claude");
        start.ArgumentList.Add("--plugin-dir"); start.ArgumentList.Add(plugin);
        start.Environment["OPENAPPLY_API_TOKEN"] = "ordinary-private-token";
        start.Environment["OPENAPPLY_BROWSER_CDP_PORT"] = "9222";
        start.Environment["OTEL_LOG_RAW_API_BODIES"] = "file:synthetic-capture";
        start.Environment["OTEL_LOG_TOOL_CONTENT"] = "true";
        start.Environment["CLAUDE_CODE_SESSION_LOG"] = "synthetic-transcript";
        start.Environment["CLAUDE_CODE_DEBUG_LOGS_DIR"] = "synthetic-debug";
        var budget = new ModelBudget(12, 120000, 0, 12, 12, 2, 180, null);
        AccountProcessSettings.Configure(start, new InstallPaths { WorkingDir = workspace, PluginDir = plugin }, claim, budget);
        Assert.DoesNotContain("--plugin-dir", start.ArgumentList);
        Assert.DoesNotContain("--resume", start.ArgumentList);
        Assert.DoesNotContain("--strict-mcp-config", start.ArgumentList);
        Assert.DoesNotContain("--bare", start.ArgumentList);
        Assert.Contains("--no-session-persistence", start.ArgumentList);
        Assert.Contains("--no-chrome", start.ArgumentList);
        Assert.Contains("--disable-slash-commands", start.ArgumentList);
        var arguments = start.ArgumentList.ToList();
        Assert.Equal("user", arguments[arguments.IndexOf("--setting-sources") + 1]);
        Assert.Equal("ToolSearch", arguments[arguments.IndexOf("--tools") + 1]);
        Assert.Equal("dontAsk", arguments[arguments.IndexOf("--permission-mode") + 1]);
        Assert.DoesNotContain(start.Environment.Keys, key => key.StartsWith("OPENAPPLY_"));
        Assert.Equal("false", start.Environment["OTEL_LOG_RAW_API_BODIES"]);
        Assert.Equal("false", start.Environment["OTEL_LOG_TOOL_CONTENT"]);
        Assert.Equal("false", start.Environment["OTEL_LOG_ASSISTANT_RESPONSES"]);
        Assert.Equal("false", start.Environment["CLAUDE_CODE_TEE_SDK_STDOUT"]);
        Assert.False(start.Environment.ContainsKey("CLAUDE_CODE_SESSION_LOG"));
        Assert.False(start.Environment.ContainsKey("CLAUDE_CODE_DEBUG_LOGS_DIR"));
        var files = Directory.GetFiles(Path.Combine(workspace, "account-provider"));
        Assert.All(files, file => Assert.DoesNotContain("ordinary-private-token", File.ReadAllText(file)));
        using var config = JsonDocument.Parse(File.ReadAllText(Path.Combine(workspace, "account-provider", "mcp.json")));
        Assert.Single(config.RootElement.GetProperty("mcpServers").EnumerateObject());
        Assert.True(config.RootElement.GetProperty("mcpServers").TryGetProperty("openapply_account", out _));
        using var settings = JsonDocument.Parse(File.ReadAllText(Path.Combine(workspace, "account-provider", "settings.json")));
        Assert.Equal(["openapply_account", "claude.ai Gmail", "claude_ai_Gmail", "https://gmailmcp.googleapis.com/mcp/v1"], settings.RootElement.GetProperty("allowedMcpServers")
            .EnumerateArray().Select(value => (value.TryGetProperty("serverName", out var name) ? name : value.GetProperty("serverUrl")).GetString()).ToArray());
        Assert.False(settings.RootElement.GetProperty("disableAllHooks").GetBoolean());
        Assert.Equal(["PreToolUse", "PostToolUse", "PostToolUseFailure"], settings.RootElement.GetProperty("hooks").EnumerateObject().Select(value => value.Name).ToArray());
    }
}
