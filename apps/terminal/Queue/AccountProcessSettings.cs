using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using OpenApply.Terminal.Agent;
using OpenApply.Terminal.Connectors;
using OpenApply.Terminal.Hosting;
using OpenApply.Terminal.Providers;
using OpenApply.Terminal.Sessions;

namespace OpenApply.Terminal.Queue;

internal static class AccountProcessSettings
{
    internal static string Instructions(AgentRequest claim)
    {
        var plugin = claim.PluginStage ?? throw new InvalidOperationException("Account instructions require the pinned plugin stage.");
        var path = Path.Combine(plugin.PluginDir, "skills", "_shared", "account-queue.md");
        var bytes = File.ReadAllBytes(path);
        if (bytes.Length > 32000) throw new InvalidDataException("Account instructions exceeded their bound.");
        return new System.Text.UTF8Encoding(false, true).GetString(bytes);
    }
    internal static void Configure(ProcessStartInfo start, InstallPaths paths, AgentRequest claim, ModelBudget budget)
    {
        if (claim.AccountSetup is null || claim.Browser is null || claim.Provider != "claude" || claim.ProviderSessionId is not null || budget.MaxSubagents != 0)
            throw new InvalidOperationException("An account model requires an exact fresh isolated grant.");
        var node = ExecutablePath.Find("node") ?? throw new InvalidOperationException("Account MCP runtime is unavailable.");
        var mcp = Path.Combine(paths.PluginDir, "bin", "account-mcp.mjs");
        if (!File.Exists(mcp)) throw new InvalidOperationException("Account MCP implementation is unavailable.");
        var directory = Path.Combine(paths.WorkingDir, "account-provider");
        Directory.CreateDirectory(directory);
        var evidencePath = Path.Combine(directory, "tool-state.json");
        WriteNew(evidencePath, JsonSerializer.Serialize(new AccountToolState { Snapshot = claim.AccountSetup }, AppJsonContext.Default.AccountToolState));
        var (command, prefix) = GmailCheckProtocol.HookExecutable();
        JsonArray Hook(string stage) => new(new JsonObject
        {
            ["matcher"] = "*", ["hooks"] = new JsonArray(new JsonObject
            {
                ["type"] = "command", ["command"] = command,
                ["args"] = new JsonArray([.. prefix.Concat([AccountToolGate.Flag, evidencePath, stage]).Select(value => (JsonNode?)JsonValue.Create(value))]),
                ["timeout"] = 5,
            }),
        });
        var settings = new JsonObject
        {
            ["model"] = "sonnet", ["disableAllHooks"] = false,
            // Claude 2.1.294 suppresses claude.ai connectors under --strict-mcp-config.
            // Empty setting sources exclude user/project MCP configuration; this exact
            // admission list retains the existing OAuth Gmail connector and our broker.
            // Claude's stricter managed MCP policy remains authoritative.
            ["allowedMcpServers"] = new JsonArray(
                new JsonObject { ["serverName"] = "openapply_account" },
                new JsonObject { ["serverName"] = "claude.ai Gmail" },
                // The connector may be matched by its normalized name or its URL rather than its label.
                new JsonObject { ["serverName"] = "claude_ai_Gmail" },
                new JsonObject { ["serverUrl"] = "https://gmailmcp.googleapis.com/mcp/v1" }),
            ["hooks"] = new JsonObject { ["PreToolUse"] = Hook("pre"), ["PostToolUse"] = Hook("post"), ["PostToolUseFailure"] = Hook("post") },
        };
        var settingsPath = Path.Combine(directory, "settings.json");
        WriteNew(settingsPath, settings.ToJsonString());
        var configPath = Path.Combine(directory, "mcp.json");
        WriteNew(configPath, new JsonObject
        {
            ["mcpServers"] = new JsonObject
            {
                ["openapply_account"] = new JsonObject
                {
                    ["command"] = node, ["args"] = new JsonArray(mcp),
                    ["env"] = new JsonObject
                    {
                        ["OPENAPPLY_COMPANION"] = claim.Browser.CompanionUrl,
                        ["OPENAPPLY_BROWSER_SESSION_ID"] = Path.GetFileName(claim.Browser.Workspace),
                        ["OPENAPPLY_WORKER_CAPABILITY"] = claim.Browser.Capability,
                    },
                },
            },
        }.ToJsonString());
        start.ArgumentList.Clear();
        List<string> args = ["-p", "--output-format", "stream-json", "--verbose", "--tools", "ToolSearch", "--permission-mode", "dontAsk",
            "--permission-prompts", "none", "--settings", settingsPath, "--mcp-config", configPath,
            "--disable-slash-commands", "--no-session-persistence", "--no-chrome"];
        budget.AddArguments(args);
        // claude.ai connectors load only with the user setting source, as in the Gmail check;
        // allowedMcpServers above still admits nothing but Gmail and the account broker.
        args[args.LastIndexOf("--setting-sources") + 1] = "user";
        foreach (var arg in args) start.ArgumentList.Add(arg);
        foreach (var key in start.Environment.Keys.Where(key => key.StartsWith("OPENAPPLY_", StringComparison.OrdinalIgnoreCase)).ToArray()) start.Environment.Remove(key);
        start.Environment.Remove("CLAUDECODE");
        // Native CLI content telemetry and recording can persist tool secrets independently of session persistence.
        foreach (var key in new[] { "OTEL_LOG_RAW_API_BODIES", "OTEL_LOG_USER_PROMPTS", "OTEL_LOG_ASSISTANT_RESPONSES", "OTEL_LOG_TOOL_CONTENT", "OTEL_LOG_TOOL_DETAILS",
            "ENABLE_BETA_TRACING_DETAILED", "CLAUDE_CODE_ENHANCED_TELEMETRY_BETA", "ENABLE_ENHANCED_TELEMETRY_BETA", "CLAUDE_CODE_TEE_SDK_STDOUT" }) start.Environment[key] = "false";
        foreach (var key in new[] { "CLAUDE_CODE_DEBUG_LOGS_DIR", "CLAUDE_CODE_DIAGNOSTICS_FILE", "CLAUDE_CODE_SESSION_LOG", "CLAUDE_CODE_TERMINAL_RECORDING",
            "CLAUDE_PTY_RECORD", "CLAUDE_CODE_PERFETTO_TRACE", "CLAUDE_DEBUG", "DEBUG_CLAUDE_AGENT_SDK", "DEBUG_SDK", "DEBUG", "NODE_DEBUG", "DEBUG_AUTH" }) start.Environment.Remove(key);
    }

    private static void WriteNew(string path, string content)
    {
        using var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        using var writer = new StreamWriter(file);
        writer.Write(content);
    }
}
