using System.ComponentModel;
using System.Diagnostics;
using System.Text;
using OpenApply.Terminal.Inference;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed class InferenceRunnerTests
{
    private static readonly InferenceResponse Ready = new("codex", "default", "OPENAPPLY_READY");

    [Fact]
    public async Task ResumeTextRoundTripsThroughUtf8PipesWithoutBom()
    {
        const string resume = "Yuchen 林 — résumé, Montréal; C++ engineer";
        var windows = OperatingSystem.IsWindows();
        var start = new ProcessStartInfo(windows ? "powershell.exe" : "/bin/sh")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardInputEncoding = Encoding.Latin1,
            StandardOutputEncoding = Encoding.Latin1,
            StandardErrorEncoding = Encoding.Latin1,
        };
        if (windows)
        {
            start.ArgumentList.Add("-NoProfile");
            start.ArgumentList.Add("-NonInteractive");
            start.ArgumentList.Add("-Command");
            start.ArgumentList.Add("$utf8 = [Text.UTF8Encoding]::new($false, $true); $reader = [IO.StreamReader]::new([Console]::OpenStandardInput(), $utf8, $false); $received = $reader.ReadToEnd(); $bytes = $utf8.GetBytes($received); $output = [Console]::OpenStandardOutput(); $output.Write($bytes, 0, $bytes.Length); $output.Flush()");
        }
        else
        {
            start.ArgumentList.Add("-c");
            start.ArgumentList.Add("cat");
        }

        var output = await InferenceRunner.RunProcessAsync(start, resume, TestContext.Current.CancellationToken);

        Assert.Equal(resume, output);
        Assert.Empty(start.StandardInputEncoding!.GetPreamble());
        Assert.Equal(Encoding.UTF8.CodePage, start.StandardOutputEncoding!.CodePage);
        Assert.Equal(Encoding.UTF8.CodePage, start.StandardErrorEncoding!.CodePage);
    }

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
        var missing = new ProcessStartInfo(Path.Combine(dir.Root, "missing-openapply-agent"))
        {
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };

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

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task OverflowStopsTheFakeProcessAndReleasesTheBusyGate(bool stderr)
    {
        var windows = OperatingSystem.IsWindows();
        var start = new ProcessStartInfo(windows ? "powershell.exe" : "/bin/sh")
        {
            UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
        };
        if (windows)
        {
            start.ArgumentList.Add("-NoProfile"); start.ArgumentList.Add("-NonInteractive"); start.ArgumentList.Add("-Command");
            start.ArgumentList.Add("$writer = [Console]::" + (stderr ? "Error" : "Out") + "; $chunk = 'x' * 4096; for (;;) { $writer.Write($chunk); $writer.Flush() }");
        }
        else
        {
            start.ArgumentList.Add("-c"); start.ArgumentList.Add("while :; do printf '%04096d' 0" + (stderr ? " >&2" : "") + "; done");
        }
        var runner = new InferenceRunner();
        await Assert.ThrowsAsync<InvalidDataException>(() => runner.RunAsync(async ct =>
        {
            await InferenceRunner.RunProcessAsync(start, "synthetic", ct); return Ready;
        }, TimeSpan.FromSeconds(20), TestContext.Current.CancellationToken).WaitAsync(TimeSpan.FromSeconds(10), TestContext.Current.CancellationToken));
        Assert.Equal(Ready, await runner.RunAsync(_ => Task.FromResult(Ready), TimeSpan.FromSeconds(1), TestContext.Current.CancellationToken));
    }
}
