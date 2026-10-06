using System.ComponentModel;
using System.Diagnostics;
using OpenApply.Terminal.Inference;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed class InferenceRunnerTests
{
    private static readonly InferenceResponse Ready = new("codex", "default", "OPENAPPLY_READY");

    [Fact]
    public async Task CancellationKillsTheProcessTreeAndLetsAnotherProviderRetry()
    {
        using var dir = new TempDir();
        using var request = new CancellationTokenSource();
        var runner = new InferenceRunner();
        var pidFile = Path.Combine(dir.Root, "pids.txt");
        var running = runner.RunAsync(async ct =>
        {
            await InferenceRunner.RunProcessAsync(StalledProcess(pidFile), new string('x', 80000), ct);
            return Ready;
        }, TimeSpan.FromSeconds(20), request.Token);

        int[] pids;
        try
        {
            pids = await WaitForPids(pidFile);
            Assert.Null(await runner.RunAsync(_ => Task.FromResult(Ready), TimeSpan.FromSeconds(1), CancellationToken.None));
        }
        finally { request.Cancel(); }

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => running.WaitAsync(TimeSpan.FromSeconds(8), TestContext.Current.CancellationToken));
        await TestWait.Until(() => pids.All(HasExited));
        Assert.All(pids, pid => Assert.True(HasExited(pid), $"Child process {pid} was not stopped."));
        var retried = await runner.RunAsync(_ => Task.FromResult(Ready with { Provider = "claude" }), TimeSpan.FromSeconds(1), CancellationToken.None);
        Assert.Equal("claude", retried?.Provider);
    }

    [Fact]
    public async Task DeadlineReleasesTheBusyGateWithoutAClientCancellation()
    {
        var runner = new InferenceRunner();
        var running = runner.RunAsync(async ct =>
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, ct);
            return Ready;
        }, TimeSpan.FromMilliseconds(100), CancellationToken.None);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => running.WaitAsync(TimeSpan.FromSeconds(3), TestContext.Current.CancellationToken));
        Assert.Equal(Ready, await runner.RunAsync(_ => Task.FromResult(Ready), TimeSpan.FromSeconds(1), CancellationToken.None));
    }

    [Fact]
    public async Task FailedLaunchReleasesTheBusyGate()
    {
        using var dir = new TempDir();
        var runner = new InferenceRunner();
        var missing = new ProcessStartInfo(Path.Combine(dir.Root, "missing-openapply-agent")) { UseShellExecute = false };

        await Assert.ThrowsAsync<Win32Exception>(() => runner.RunAsync(async ct =>
        {
            await InferenceRunner.RunProcessAsync(missing, "ready", ct);
            return Ready;
        }, TimeSpan.FromSeconds(1), CancellationToken.None));

        Assert.Equal(Ready, await runner.RunAsync(_ => Task.FromResult(Ready), TimeSpan.FromSeconds(1), CancellationToken.None));
    }

    private static ProcessStartInfo StalledProcess(string pidFile)
    {
        var windows = OperatingSystem.IsWindows();
        var start = new ProcessStartInfo(windows ? "powershell.exe" : "/bin/sh")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        start.Environment["OPENAPPLY_TEST_PIDS"] = pidFile;
        if (windows)
        {
            start.ArgumentList.Add("-NoProfile");
            start.ArgumentList.Add("-NonInteractive");
            start.ArgumentList.Add("-Command");
            start.ArgumentList.Add("$child = Start-Process -FilePath $env:ComSpec -ArgumentList '/d /c ping -n 60 127.0.0.1 > nul' -WindowStyle Hidden -PassThru; [IO.File]::WriteAllText($env:OPENAPPLY_TEST_PIDS, \"$PID,$($child.Id)\"); Start-Sleep -Seconds 60");
        }
        else
        {
            start.ArgumentList.Add("-c");
            start.ArgumentList.Add("sleep 60 & child=$!; printf '%s,%s' \"$$\" \"$child\" > \"$OPENAPPLY_TEST_PIDS\"; wait");
        }
        return start;
    }

    private static async Task<int[]> WaitForPids(string path)
    {
        using var limit = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        while (true)
        {
            if (File.Exists(path))
            {
                var text = await File.ReadAllTextAsync(path, limit.Token);
                var parts = text.Split(',');
                if (parts.Length == 2 && int.TryParse(parts[0], out var parent) && int.TryParse(parts[1], out var child)) return [parent, child];
            }
            await Task.Delay(20, limit.Token);
        }
    }

    private static bool HasExited(int pid)
    {
        try
        {
            using var process = Process.GetProcessById(pid);
            return process.HasExited;
        }
        catch (ArgumentException) { return true; }
    }
}
