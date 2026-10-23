using OpenApply.Terminal.Hosting;
using OpenApply.Terminal.Providers;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed class CodexProviderTests : IDisposable
{
    private readonly TempDir temp = new();

    public void Dispose() => temp.Dispose();

    private string[] Overrides(Func<string, string?> resolve) =>
        CodexProvider.ConfigOverrides(temp.Root, NullLogger.Instance, resolve);

    [Fact]
    public void ConfigOverrides_ResolvesPluginRootWithoutShellExpansion()
    {
        temp.File(".mcp.json", """{"mcpServers":{"playwright":{"command":"node","args":["${CLAUDE_PLUGIN_ROOT}/bin/openapply-browser.mjs"]}}}""");
        var overrides = Overrides(_ => "/usr/bin/node");
        Assert.DoesNotContain(overrides, value => value.Contains("${CLAUDE_PLUGIN_ROOT}", StringComparison.Ordinal));
        Assert.Contains(overrides, value => value.Contains("openapply-browser.mjs", StringComparison.Ordinal));
    }

    [Fact]
    public void ConfigOverrides_TranslatesAStdioMcpServer()
    {
        temp.File(
            ".mcp.json",
            """{"mcpServers":{"playwright":{"command":"npx","args":["@playwright/mcp@latest","--snapshot-mode","none"]}}}""");

        Assert.Equal(
            [
                "mcp_servers.playwright.command=\"/usr/bin/npx\"",
                "mcp_servers.playwright.args=[\"@playwright/mcp@latest\",\"--snapshot-mode\",\"none\"]",
                "mcp_servers.playwright.startup_timeout_sec=120"
            ],
            Overrides(_ => "/usr/bin/npx"));
    }

    [Fact]
    public void ConfigOverrides_RunsAWindowsShimThroughCmd()
    {
        temp.File(".mcp.json", """{"mcpServers":{"playwright":{"command":"npx","args":["@playwright/mcp@latest"]}}}""");

        // Only Windows needs an interpreter for .cmd; elsewhere the direct spawn is right.
        string[] expected = OperatingSystem.IsWindows()
            ?
            [
                "mcp_servers.playwright.command=\"cmd.exe\"",
                "mcp_servers.playwright.args=[\"/c\",\"/tools/npx.cmd\",\"@playwright/mcp@latest\"]",
                "mcp_servers.playwright.startup_timeout_sec=120"
            ]
            :
            [
                "mcp_servers.playwright.command=\"/tools/npx.cmd\"",
                "mcp_servers.playwright.args=[\"@playwright/mcp@latest\"]",
                "mcp_servers.playwright.startup_timeout_sec=120"
            ];

        Assert.Equal(expected, Overrides(_ => "/tools/npx.cmd"));
    }

    [Fact]
    public void ConfigOverrides_PutsSettingsFirst_ThenStdioAndRemoteServers()
    {
        temp.File(Path.Combine("settings", "codex.json"), """{"configOverrides":["a=1"]}""");
        temp.File(
            ".mcp.json",
            """
            {"mcpServers":{
              "playwright":{"command":"npx"},
              "upwork":{"type":"http","url":"https://mcp.upwork.com/mcp"}
            }}
            """);

        var overrides = Overrides(_ => "/usr/bin/npx");

        Assert.Equal("a=1", overrides[0]);
        Assert.Contains("mcp_servers.playwright.command=\"/usr/bin/npx\"", overrides);
        Assert.Contains("mcp_servers.upwork.url=\"https://mcp.upwork.com/mcp\"", overrides);
    }

    [Theory]
    [InlineData("""{"mcpServers":{"playwright":{"command":"not-on-path"}}}""")]
    [InlineData("""{"mcpServers":{"play wright":{"command":"npx"}}}""")]
    [InlineData("""{"mcpServers":{"playwright":{"args":["pkg"]}}}""")]
    public void ConfigOverrides_SkipsAServerCodexCannotLoad(string mcpJson)
    {
        temp.File(".mcp.json", mcpJson);

        Assert.Empty(Overrides(command => command == "npx" ? "/usr/bin/npx" : null));
    }

    [Fact]
    public void ConfigOverrides_IsEmpty_WhenFilesAreMissingOrMalformed()
    {
        Assert.Empty(Overrides(_ => null));

        temp.File(Path.Combine("settings", "codex.json"), "{ not json");
        Assert.Empty(Overrides(_ => null));
    }

    [Fact]
    public void PrepareWorkspace_MirrorsTheBundledSkills_WithoutTheBootstrapOrStaleFiles()
    {
        temp.File(Path.Combine("plugin", "skills", "pilot", "SKILL.md"), "pilot-v1");
        temp.File(Path.Combine("plugin", "skills", "retired", "SKILL.md"), "retired");
        temp.File(Path.Combine("plugin", "skills", "setup", "SKILL.md"), "bootstrap");
        temp.File(Path.Combine("plugin", "skills", "_shared", "setup.md"), "shared");
        var paths = new InstallPaths { WorkingDir = temp.Root, PluginDir = Path.Combine(temp.Root, "plugin") };
        var mirrored = Path.Combine(temp.Root, ".agents", "skills");

        Provider.Codex.PrepareWorkspace(paths);
        temp.File(Path.Combine(".agents", "skills", "pilot", "stale.md"), "stale");
        temp.File(Path.Combine("plugin", "skills", "pilot", "SKILL.md"), "pilot-v2");
        Directory.Delete(Path.Combine(paths.SkillsDir, "retired"), recursive: true);
        Provider.Codex.PrepareWorkspace(paths);

        Assert.Equal("pilot-v2", File.ReadAllText(Path.Combine(mirrored, "pilot", "SKILL.md")));
        Assert.Equal("shared", File.ReadAllText(Path.Combine(mirrored, "_shared", "setup.md")));
        Assert.False(Directory.Exists(Path.Combine(mirrored, "setup")));
        Assert.False(Directory.Exists(Path.Combine(mirrored, "retired")));
        Assert.False(File.Exists(Path.Combine(mirrored, "pilot", "stale.md")));
    }
}
