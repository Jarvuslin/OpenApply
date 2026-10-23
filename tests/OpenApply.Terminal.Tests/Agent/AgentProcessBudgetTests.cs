using System.Diagnostics;
using OpenApply.Terminal.Agent;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed class AgentProcessBudgetTests
{
    [Fact]
    public async Task ZeroBudgetRejectsBeforeChildLaunch()
    {
        using var temp = new TempDir();
        var marker = Path.Combine(temp.Root, "started");
        var start = Script(OperatingSystem.IsWindows()
            ? "[IO.File]::WriteAllText($env:OPENAPPLY_TEST_MARKER, 'started')"
            : "printf started > \"$OPENAPPLY_TEST_MARKER\"");
        start.Environment["OPENAPPLY_TEST_MARKER"] = marker;
        start.Environment[ModelBudget.EnvironmentKey] = "{\"maxRequests\":0}";
        await Assert.ThrowsAsync<ModelBudgetException>(() => AgentProcess.RunProcessAsync(start, "claude", null, "private prompt", _ => Task.CompletedTask, TestContext.Current.CancellationToken));
        Assert.False(File.Exists(marker));
    }

    [Fact]
    public async Task ReachingObservedBudgetKillsProviderAndPreservesMetadataOnly()
    {
        using var temp = new TempDir();
        var path = Path.Combine(temp.Root, "usage.jsonl");
        var start = Script(OperatingSystem.IsWindows()
            ? "$null = [Console]::In.ReadToEnd(); [Console]::WriteLine($env:OPENAPPLY_TEST_EVENTS); Start-Sleep -Seconds 60"
            : "cat >/dev/null; printf '%s\\n' \"$OPENAPPLY_TEST_EVENTS\"; sleep 60");
        start.Environment["OPENAPPLY_TEST_EVENTS"] = """{"type":"assistant","message":{"id":"msg-one","usage":{"input_tokens":2,"cache_creation_input_tokens":0,"cache_read_input_tokens":100,"output_tokens":5},"content":[{"type":"text","text":"private response"}]}}""";
        var budget = ModelBudgetTests.Budget(path) with { MaxRequests = 1 };
        var events = new List<AgentEvent>();
        var result = await AgentProcess.RunProcessAsync(start, "claude", null, "private prompt", entry => { events.Add(entry); return Task.CompletedTask; }, TestContext.Current.CancellationToken, budget).WaitAsync(TimeSpan.FromSeconds(10), TestContext.Current.CancellationToken);
        Assert.Equal("failed", result.Status);
        Assert.Contains("observed request budget reached", result.Error);
        Assert.Contains("overshoot", result.Error);
        Assert.Empty(events);
        var evidence = File.ReadAllText(path);
        Assert.Contains("observed request budget reached", evidence);
        Assert.Contains("107", evidence);
        Assert.DoesNotContain("private", evidence);
    }

    [Fact]
    public async Task WallClockBudgetStopsSilentProviderAndSavesReason()
    {
        using var temp = new TempDir();
        var path = Path.Combine(temp.Root, "usage.jsonl");
        var start = Script(OperatingSystem.IsWindows() ? "Start-Sleep -Seconds 60" : "sleep 60");
        var result = await AgentProcess.RunProcessAsync(start, "claude", null, "private prompt", _ => Task.CompletedTask,
            TestContext.Current.CancellationToken, ModelBudgetTests.Budget(path) with { MaxSeconds = 1 }).WaitAsync(TimeSpan.FromSeconds(10), TestContext.Current.CancellationToken);
        Assert.Equal("failed", result.Status);
        Assert.Contains("wall-clock budget reached", result.Error);
        Assert.Contains("wall-clock budget reached", File.ReadAllText(path));
    }

    [Fact]
    public async Task SlowEventPublishingCannotKeepProviderAlivePastWallClockBudget()
    {
        using var temp = new TempDir();
        var start = Script(OperatingSystem.IsWindows()
            ? "$null = [Console]::In.ReadToEnd(); [Console]::WriteLine($env:OPENAPPLY_TEST_EVENTS); Start-Sleep -Seconds 60"
            : "cat >/dev/null; printf '%s\\n' \"$OPENAPPLY_TEST_EVENTS\"; sleep 60");
        start.Environment["OPENAPPLY_TEST_EVENTS"] = """{"type":"assistant","message":{"id":"msg-one","usage":{"input_tokens":2,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":5},"content":[{"type":"text","text":"Working"}]}}""";
        var blocked = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var result = await AgentProcess.RunProcessAsync(start, "claude", null, "private prompt", _ => blocked.Task,
            TestContext.Current.CancellationToken, ModelBudgetTests.Budget(Path.Combine(temp.Root, "usage.jsonl")) with { MaxSeconds = 2 })
            .WaitAsync(TimeSpan.FromSeconds(10), TestContext.Current.CancellationToken);
        Assert.Contains("wall-clock budget reached", result.Error);
        Assert.False(blocked.Task.IsCompleted);
    }

    [Theory]
    [InlineData("error_max_turns")]
    [InlineData("error_max_budget_usd")]
    public async Task NativeLimitsKeepSpecificStopReason(string subtype)
    {
        using var temp = new TempDir();
        var start = Script(OperatingSystem.IsWindows()
            ? "$null = [Console]::In.ReadToEnd(); [Console]::WriteLine($env:OPENAPPLY_TEST_EVENTS)"
            : "cat >/dev/null; printf '%s\\n' \"$OPENAPPLY_TEST_EVENTS\"");
        start.Environment["OPENAPPLY_TEST_EVENTS"] = "{\"type\":\"result\",\"subtype\":\"" + subtype + "\",\"is_error\":true,\"result\":\"private error\"}";
        var result = await AgentProcess.RunProcessAsync(start, "claude", null, "private prompt", _ => Task.CompletedTask,
            TestContext.Current.CancellationToken, ModelBudgetTests.Budget(Path.Combine(temp.Root, "usage.jsonl")));
        Assert.Contains(subtype, result.Error);
        Assert.DoesNotContain("private", result.Error);
    }

    private static ProcessStartInfo Script(string script)
    {
        var start = new ProcessStartInfo(OperatingSystem.IsWindows() ? "powershell.exe" : "/bin/sh")
        {
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            UseShellExecute = false, CreateNoWindow = true,
        };
        if (OperatingSystem.IsWindows())
        {
            start.ArgumentList.Add("-NoProfile");
            start.ArgumentList.Add("-NonInteractive");
            start.ArgumentList.Add("-Command");
        }
        else start.ArgumentList.Add("-c");
        start.ArgumentList.Add(script);
        return start;
    }
}
