using JobPilot.Terminal.Pty;
using Pty.Net;
using Xunit;

namespace JobPilot.Terminal.Tests;

/// <summary>
/// Regression tests for issue #17: on Unix, Pty.Net's Kill/Dispose throw for an already-exited child
/// and pty reads fail with EIO instead of EOF - neither may crash the host or wedge the Pilot loop.
/// </summary>
public sealed class PtyProcessTests
{
    private static PtyProcess CreatePty(params IPtyConnection[] connections)
    {
        var remaining = new Queue<IPtyConnection>(connections);
        return new PtyProcess(_ => remaining.Dequeue());
    }

    [Fact]
    public void Stop_ToleratesKillAndDisposeOfDeadProcess()
    {
        var connection = new FakePtyConnection { KillThrows = true, DisposeThrows = true };
        using var pty = CreatePty(connection);
        pty.Start("claude", [], ".", 80, 24);

        pty.Stop();

        Assert.Equal(1, connection.DisposeCalls);
    }

    [Fact]
    public void Start_ReplacesConnectionWhoseKillThrows()
    {
        var dead = new FakePtyConnection { KillThrows = true, DisposeThrows = true };
        var replacement = new FakePtyConnection();
        using var pty = CreatePty(dead, replacement);

        var first = pty.Start("claude", [], ".", 80, 24);
        var second = pty.Start("claude", [], ".", 80, 24);

        Assert.NotEqual(first, second);
        Assert.Equal(1, dead.DisposeCalls);
    }

    [Fact]
    public async Task ReadFailure_RaisesExit_InsteadOfCrashing()
    {
        var connection = new FakePtyConnection { ExitCode = 42 };
        using var pty = CreatePty(connection);
        PtyExit? exit = null;
        pty.ProcessExited += e => exit = e;

        var generation = pty.Start("claude", [], ".", 80, 24);
        connection.Reader.FailNextRead(new IOException("Input/output error"));

        await TestWait.Until(() => exit is not null);
        Assert.Equal(generation, exit!.Value.Generation);
        Assert.Equal(42, exit.Value.ExitCode);
    }

    [Fact]
    public async Task ReadFailure_AfterStop_StaysSilent()
    {
        var connection = new FakePtyConnection();
        using var pty = CreatePty(connection);
        var exits = 0;
        pty.ProcessExited += _ => Interlocked.Increment(ref exits);

        pty.Start("claude", [], ".", 80, 24);
        pty.Stop();
        connection.Reader.FailNextRead(new IOException("Input/output error"));

        // Longer than the EOF grace, so a wrongly raised fallback exit would have landed by now.
        await Task.Delay(700, TestContext.Current.CancellationToken);
        Assert.Equal(0, exits);
    }

    [Fact]
    public void Write_ToleratesDeadPty()
    {
        var connection = new FakePtyConnection { Writer = new DeadWriteStream() };
        using var pty = CreatePty(connection);
        pty.Start("claude", [], ".", 80, 24);

        pty.Write("hello"u8.ToArray());
    }

    [Fact]
    public void Resize_ToleratesDeadPty()
    {
        var connection = new FakePtyConnection { ResizeThrows = true };
        using var pty = CreatePty(connection);
        pty.Start("claude", [], ".", 80, 24);

        pty.Resize(120, 40);
    }
}
