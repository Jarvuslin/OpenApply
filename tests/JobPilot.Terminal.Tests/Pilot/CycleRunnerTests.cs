using JobPilot.Terminal.Pilot;
using Xunit;
using static JobPilot.Terminal.Tests.Builders;
using Reports = JobPilot.Terminal.Pilot.CycleRunner.Reports;

namespace JobPilot.Terminal.Tests;

/// <summary>Starting, finishing, and the check-in -> skip -> restart ladder.</summary>
public class CycleRunnerTests
{
    private static readonly string[] FullLadder = ["cycle", "wait", "check-in", "wait", "skip", "wait", "stop"];

    // An interval at least as long as every wait makes each wait a single "wait" action.
    internal static CycleRunner Runner(FakePilotSession session) => new(session, TimeSpan.FromMinutes(20));

    internal static Task<TimeSpan?> RunAsync(CycleRunner runner, FakePilotSession session, CancellationToken? ct = null) =>
        runner.RunAsync(Settings(), session.NextActivity() ?? Activity(Stale), ct ?? TestContext.Current.CancellationToken);

    [Fact]
    public async Task Run_StartsTheSession_ThenReturnsTheSentinelsSleep()
    {
        var session = new FakePilotSession();
        session.Signals.Enqueue(WaitResult.Sentinel(Cycle(30, CycleStatus.Empty)));
        var runner = Runner(session);

        var sleep = await RunAsync(runner, session);

        Assert.Equal(["start", "sleep:15", "cycle", "wait"], session.Actions);
        Assert.Equal(TimeSpan.FromSeconds(30), sleep);
        Assert.Equal(CycleStatus.Empty, runner.LastCycleStatus);
        Assert.NotNull(runner.LastCycleAt);
        Assert.True(runner.Conducting);
    }

    [Fact]
    public async Task Run_ClampsTheSleep_AndReusesARunningSession()
    {
        var session = new FakePilotSession { RunningProvider = "claude" };
        var runner = Runner(session);

        session.Signals.Enqueue(WaitResult.Sentinel(Cycle(5)));
        Assert.Equal(TimeSpan.FromSeconds(CycleRunner.MinSleepSeconds), await RunAsync(runner, session));

        session.Signals.Enqueue(WaitResult.Sentinel(Cycle(999999)));
        Assert.Equal(TimeSpan.FromSeconds(CycleRunner.MaxSleepSeconds), await RunAsync(runner, session));
        Assert.DoesNotContain("start", session.Actions);
    }

    [Fact]
    public async Task Run_Pauses_WhenTheUserRunsTheOtherProvider()
    {
        var session = new FakePilotSession { RunningProvider = "codex" };
        var runner = Runner(session);

        var sleep = await RunAsync(runner, session);

        Assert.Null(sleep);
        Assert.Equal(["sleep:5"], session.Actions);
        Assert.False(runner.Conducting);
    }

    [Fact]
    public async Task Run_EndsWithoutIntervening_WhenTheSessionExitsMidWait()
    {
        var session = new FakePilotSession { RunningProvider = "claude" };
        session.Signals.Enqueue(WaitResult.Exited);
        var runner = Runner(session);

        var sleep = await RunAsync(runner, session);

        Assert.Null(sleep);
        Assert.Equal(["cycle", "wait"], session.Actions);
        Assert.Equal(0, runner.ConsecutiveRestarts);
    }

    [Fact]
    public async Task Run_BacksOff_OnlyAfterThreeExitsInARow()
    {
        var session = new FakePilotSession { RunningProvider = "claude" };
        var runner = Runner(session);

        async Task Exit()
        {
            session.Signals.Enqueue(WaitResult.Exited);
            await RunAsync(runner, session);
        }

        await Exit();
        await Exit();
        session.Signals.Enqueue(WaitResult.Sentinel(Cycle(30))); // a finished cycle breaks the run
        await RunAsync(runner, session);
        await Exit();
        await Exit();
        Assert.DoesNotContain(Reports.ExitBackoff, session.Reports);

        await Exit();

        Assert.Equal([Reports.ExitBackoff], session.Reports);
        Assert.Equal("sleep:1800", session.Actions[^1]);
        Assert.Equal(0, runner.ConsecutiveExits);
    }

    [Theory]
    [InlineData(WaitOutcome.Timeout, WaitOutcome.Timeout, WaitOutcome.Timeout)]
    [InlineData(WaitOutcome.Stuck, WaitOutcome.Stuck, WaitOutcome.Stuck)]
    [InlineData(WaitOutcome.Timeout, WaitOutcome.Stuck, WaitOutcome.Timeout)]
    public async Task Run_ChecksInThenSkipsThenRestarts_WhenTheCycleStaysStuck(params WaitOutcome[] outcomes)
    {
        var session = new FakePilotSession { RunningProvider = "claude" };
        foreach (var outcome in outcomes)
        {
            session.Signals.Enqueue(new WaitResult(outcome));
        }

        var runner = Runner(session);

        var sleep = await RunAsync(runner, session);

        Assert.Null(sleep);
        Assert.Equal(FullLadder, session.Actions);
        Assert.Equal([Reports.CheckIn, Reports.Skip, Reports.Restart], session.Reports);
        Assert.Equal(1, runner.ConsecutiveRestarts);
    }

    [Fact]
    public async Task Run_Recovers_WhenTheCheckInUnsticksTheAgent()
    {
        var session = new FakePilotSession { RunningProvider = "claude" };
        session.Signals.Enqueue(WaitResult.Timeout);
        session.Signals.Enqueue(WaitResult.Sentinel(Cycle(20)));

        var sleep = await RunAsync(Runner(session), session);

        Assert.Equal(["cycle", "wait", "check-in", "wait"], session.Actions);
        Assert.Equal(TimeSpan.FromSeconds(20), sleep);
        Assert.Equal([Reports.CheckIn], session.Reports);
    }

    [Fact]
    public async Task Run_Recovers_WhenTheSkipUnsticksTheAgent()
    {
        var session = new FakePilotSession { RunningProvider = "claude" };
        session.Signals.Enqueue(WaitResult.Stuck);
        session.Signals.Enqueue(WaitResult.Stuck);
        session.Signals.Enqueue(WaitResult.Sentinel(Cycle(45)));

        var sleep = await RunAsync(Runner(session), session);

        Assert.Equal(["cycle", "wait", "check-in", "wait", "skip", "wait"], session.Actions);
        Assert.Equal(TimeSpan.FromSeconds(45), sleep);
        Assert.Equal([Reports.CheckIn, Reports.Skip], session.Reports);
    }

    [Fact]
    public async Task Run_BacksOff_OnTheThirdRestartInARow()
    {
        var session = new FakePilotSession { RunningProvider = "claude" };
        var runner = Runner(session);

        await RunAsync(runner, session);
        await RunAsync(runner, session);
        Assert.DoesNotContain("sleep:1800", session.Actions);
        Assert.DoesNotContain(Reports.Backoff, session.Reports);

        await RunAsync(runner, session);

        Assert.Equal(3, runner.ConsecutiveRestarts);
        Assert.Equal("sleep:1800", session.Actions[^1]);
        Assert.Single(session.Reports, r => r == Reports.Backoff);
    }

    [Fact]
    public async Task Run_ResetsTheRestartCount_AfterAFinishedCycle()
    {
        var session = new FakePilotSession { RunningProvider = "claude" };
        var runner = Runner(session);

        await RunAsync(runner, session);
        Assert.Equal(1, runner.ConsecutiveRestarts);

        session.Signals.Enqueue(WaitResult.Sentinel(Cycle(30)));
        await RunAsync(runner, session);
        Assert.Equal(0, runner.ConsecutiveRestarts);
    }
}
