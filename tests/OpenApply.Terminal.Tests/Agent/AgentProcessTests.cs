using System.Diagnostics;
using System.Text;
using OpenApply.Terminal.Agent;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed class AgentProcessTests
{
    [Fact]
    public async Task UnicodeRoundTripsThroughRawUtf8ChildPipesWithoutBom()
    {
        const string expected = "Amber — custom test answer; résumé; 林雨晨";
        var start = Script(OperatingSystem.IsWindows()
            ? "$utf8 = [Text.UTF8Encoding]::new($false, $true); $reader = [IO.StreamReader]::new([Console]::OpenStandardInput(), $utf8, $false); $received = $reader.ReadToEnd(); $json = @{type='result'; is_error=$false; result=$received} | ConvertTo-Json -Compress; $bytes = $utf8.GetBytes($json + [Environment]::NewLine); $output = [Console]::OpenStandardOutput(); $output.Write($bytes, 0, $bytes.Length); $output.Flush()"
            : "input=$(cat); printf '{\"type\":\"result\",\"is_error\":false,\"result\":\"%s\"}\\n' \"$input\"");
        // Emulate a Windows launch inherited from a legacy-codepage shell.
        start.StandardInputEncoding = Encoding.Latin1;
        start.StandardOutputEncoding = Encoding.Latin1;
        start.StandardErrorEncoding = Encoding.Latin1;
        List<AgentEvent> events = [];
        var result = await AgentProcess.RunProcessAsync(start, "claude", null, expected, entry => { events.Add(entry); return Task.CompletedTask; }, TestContext.Current.CancellationToken);
        Assert.Equal("completed", result.Status);
        Assert.Equal(expected, Assert.Single(events).Content);
        Assert.Empty(start.StandardInputEncoding!.GetPreamble());
        Assert.Equal(Encoding.UTF8.CodePage, start.StandardErrorEncoding!.CodePage);
    }

    [Theory]
    [InlineData("{\"type\":\"result\",\"is_error\":false,\"result\":\"Hello\"}", "completed")]
    [InlineData("{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"one\"}", "interrupted")]
    public async Task ProcessExitWithoutProtocolCompletionIsNotSuccess(string events, string expected)
    {
        var start = Script(OperatingSystem.IsWindows()
            ? "$null = [Console]::In.ReadToEnd(); [Console]::WriteLine($env:OPENAPPLY_TEST_EVENTS)"
            : "cat >/dev/null; printf '%s\\n' \"$OPENAPPLY_TEST_EVENTS\"");
        start.Environment["OPENAPPLY_TEST_EVENTS"] = events;
        var result = await AgentProcess.RunProcessAsync(start, "claude", null, "Test prompt", _ => Task.CompletedTask, TestContext.Current.CancellationToken);
        Assert.Equal(expected, result.Status);
    }

    [Fact]
    public async Task CancellationKillsProcessAndItsChild()
    {
        using var temp = new TempDir();
        var pidFile = Path.Combine(temp.Root, "agent-pids.txt");
        var start = Script(OperatingSystem.IsWindows()
            ? "$child = Start-Process -FilePath $env:ComSpec -ArgumentList '/d /c ping -n 60 127.0.0.1 > nul' -WindowStyle Hidden -PassThru; $pending = $env:OPENAPPLY_TEST_PIDS + '.pending'; [IO.File]::WriteAllText($pending, \"$PID,$($child.Id)\"); [IO.File]::Move($pending, $env:OPENAPPLY_TEST_PIDS); Start-Sleep -Seconds 60"
            : "sleep 60 & child=$!; printf '%s,%s' \"$$\" \"$child\" > \"$OPENAPPLY_TEST_PIDS.pending\"; mv \"$OPENAPPLY_TEST_PIDS.pending\" \"$OPENAPPLY_TEST_PIDS\"; wait");
        start.Environment["OPENAPPLY_TEST_PIDS"] = pidFile;
        using var cancel = new CancellationTokenSource();
        var running = AgentProcess.RunProcessAsync(start, "claude", null, "Hello", _ => Task.CompletedTask, cancel.Token);
        // Publish only after closing the writer, so existence proves both PIDs are available.
        await TestWait.Until(() => File.Exists(pidFile));
        var pids = (await File.ReadAllTextAsync(pidFile, TestContext.Current.CancellationToken)).Split(',').Select(int.Parse).ToArray();
        Assert.Equal(2, pids.Distinct().Count());
        Assert.All(pids, pid => Assert.True(pid > 0));
        await cancel.CancelAsync();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => running.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken));
        await TestWait.Until(() => pids.All(Exited));
        Assert.All(pids, pid => Assert.True(Exited(pid)));
    }

    [Fact]
    public async Task InvalidProtocolFailsClosed()
    {
        var start = Script(OperatingSystem.IsWindows()
            ? "$null = [Console]::In.ReadToEnd(); [Console]::WriteLine('terminal ANSI is not JSON')"
            : "cat >/dev/null; printf 'terminal ANSI is not JSON\\n'");
        await Assert.ThrowsAnyAsync<System.Text.Json.JsonException>(() => AgentProcess.RunProcessAsync(start, "claude", null, "Test", _ => Task.CompletedTask, TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task CancellationBeforeLaunchNeverStartsTheProcess()
    {
        using var temp = new TempDir();
        var marker = Path.Combine(temp.Root, "must-not-exist");
        var start = Script(OperatingSystem.IsWindows()
            ? "[IO.File]::WriteAllText($env:OPENAPPLY_TEST_MARKER, 'started')"
            : "printf started > \"$OPENAPPLY_TEST_MARKER\"");
        start.Environment["OPENAPPLY_TEST_MARKER"] = marker;
        using var cancel = new CancellationTokenSource();
        cancel.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => AgentProcess.RunProcessAsync(start, "claude", null, "Hello", _ => Task.CompletedTask, cancel.Token));
        Assert.False(File.Exists(marker));
    }

    private static bool Exited(int pid)
    {
        try { using var process = Process.GetProcessById(pid); return process.HasExited; }
        catch (ArgumentException) { return true; }
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
