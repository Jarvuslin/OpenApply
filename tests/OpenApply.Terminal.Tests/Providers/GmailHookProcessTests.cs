using System.Runtime.InteropServices;
using System.Text.Json;
using OpenApply.Terminal.Connectors;
using OpenApply.Terminal.Inference;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed class GmailHookProcessTests
{
    [Fact]
    public async Task CompiledCompanionRunsTheGateWithoutStartingTheHostOrAnAgent()
    {
        var runtimeRoot = new DirectoryInfo(RuntimeEnvironment.GetRuntimeDirectory()).Parent!.Parent!.Parent!.FullName;
        var dotnet = Path.Combine(runtimeRoot, OperatingSystem.IsWindows() ? "dotnet.exe" : "dotnet");
        var statePath = Path.Combine(Path.GetTempPath(), $"OpenApply Gmail hook {Guid.NewGuid():N}.json");
        var assembly = Path.Combine(AppContext.BaseDirectory, "openapply.dll");
        await File.WriteAllTextAsync(statePath, "{\"expectedEmail\":\"person@example.com\"}", TestContext.Current.CancellationToken);
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
        limit.CancelAfter(TimeSpan.FromSeconds(15));
        try
        {
            async Task<string> Run(string stage, string payload) => await InferenceRunner.RunProcessAsync(
                GmailCheckProtocol.Process(dotnet, AppContext.BaseDirectory, [assembly, GmailToolGate.Flag, statePath, stage]), payload, limit.Token);

            var denied = await Run("pre", "{\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Bash\",\"tool_input\":{}}");
            Assert.Contains("\"permissionDecision\":\"deny\"", denied);
            var allowed = await Run("pre", "{\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"mcp__claude_ai_Gmail__get_profile\",\"tool_use_id\":\"profile-1\",\"tool_input\":{}}");
            Assert.Contains("\"permissionDecision\":\"allow\"", allowed);
            await Run("post", "{\"hook_event_name\":\"PostToolUse\",\"tool_name\":\"mcp__claude_ai_Gmail__get_profile\",\"tool_use_id\":\"profile-1\",\"tool_response\":{\"emailAddress\":\"person@example.com\"}}");
            var evidence = JsonSerializer.Deserialize(await File.ReadAllTextAsync(statePath, limit.Token), AppJsonContext.Default.GmailCheckEvidence);
            Assert.True(evidence!.ProfileSucceeded);
            Assert.Equal("person@example.com", evidence.Mailbox);
        }
        finally { File.Delete(statePath); }
    }
}
