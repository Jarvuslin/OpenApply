using OpenApply.Terminal.Pilot;
using OpenApply.Terminal.Providers;
using Xunit;
using static OpenApply.Terminal.Tests.Builders;
using Reports = OpenApply.Terminal.Pilot.CycleRunner.Reports;

namespace OpenApply.Terminal.Tests;

public class CycleRunnerTests
{
    private static readonly string[] FullLadder = ["cycle", "wait", "check-in", "wait", "skip", "wait", "stop"];

    // An interval at least as long as every wait makes each wait a single "wait" action.
    private static CycleRunner Runner(FakePilotSession session) => new(session, TimeSpan.FromMinutes(20));

    private static Task<TimeSpan?> RunAsync(CycleRunner runner, FakePilotSession session, CancellationToken? ct = null) =>
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
        var session = new FakePilotSession { RunningProvider = Provider.Claude };
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
        var session = new FakePilotSession { RunningProvider = Provider.Codex };
        var runner = Runner(session);

        var sleep = await RunAsync(runner, session);

        Assert.Null(sleep);
        Assert.Equal(["sleep:5"], session.Actions);
        Assert.False(runner.Conducting);
    }

    [Fact]
    public async Task Run_EndsWithoutIntervening_WhenTheSessionExitsMidWait()
    {
        var session = new FakePilotSession { RunningProvider = Provider.Claude };
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
        var session = new FakePilotSession { RunningProvider = Provider.Claude };
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
    [InlineData(WaitOutcome.Timeout)]
    [InlineData(WaitOutcome.Stuck)]
    public async Task Run_ChecksInThenSkipsThenRestarts_WhenTheCycleStaysStuck(WaitOutcome outcome)
    {
        var session = new FakePilotSession { RunningProvider = Provider.Claude };
        for (var i = 0; i < 3; i++)
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
    public async Task Run_Recovers_WhenACheckInOrSkipUnsticksTheAgent()
    {
        var checkedIn = new FakePilotSession { RunningProvider = Provider.Claude };
        checkedIn.Signals.Enqueue(WaitResult.Timeout);
        checkedIn.Signals.Enqueue(WaitResult.Sentinel(Cycle(20)));

        Assert.Equal(TimeSpan.FromSeconds(20), await RunAsync(Runner(checkedIn), checkedIn));
        Assert.Equal(["cycle", "wait", "check-in", "wait"], checkedIn.Actions);
        Assert.Equal([Reports.CheckIn], checkedIn.Reports);

        var skipped = new FakePilotSession { RunningProvider = Provider.Claude };
        skipped.Signals.Enqueue(WaitResult.Stuck);
        skipped.Signals.Enqueue(WaitResult.Stuck);
        skipped.Signals.Enqueue(WaitResult.Sentinel(Cycle(45)));

        Assert.Equal(TimeSpan.FromSeconds(45), await RunAsync(Runner(skipped), skipped));
        Assert.Equal(["cycle", "wait", "check-in", "wait", "skip", "wait"], skipped.Actions);
        Assert.Equal([Reports.CheckIn, Reports.Skip], skipped.Reports);
    }

    [Fact]
    public async Task Run_BacksOff_OnTheThirdRestartInARow_AndAFinishedCycleResetsTheCount()
    {
        var session = new FakePilotSession { RunningProvider = Provider.Claude };
        var runner = Runner(session);

        await RunAsync(runner, session);
        session.Signals.Enqueue(WaitResult.Sentinel(Cycle(30)));
        await RunAsync(runner, session);
        Assert.Equal(0, runner.ConsecutiveRestarts);

        await RunAsync(runner, session);
        await RunAsync(runner, session);
        Assert.DoesNotContain(Reports.Backoff, session.Reports);

        await RunAsync(runner, session);

        Assert.Equal(3, runner.ConsecutiveRestarts);
        Assert.Equal("sleep:1800", session.Actions[^1]);
        Assert.Single(session.Reports, r => r == Reports.Backoff);
    }

    [Theory]
    [InlineData(120, 120)]
    [InlineData(null, CycleRunner.MinSleepSeconds)]
    public async Task Run_Finishes_WhenTheServerRecordsACompletionTheTerminalGarbled(int? sleepHint, int expectedSleep)
    {
        var session = new FakePilotSession { RunningProvider = Provider.Claude, DefaultActivity = Activity(Stale, Completed(sleepHint)) };
        session.Activities.Enqueue(Activity(Stale)); // baseline: nothing finished yet

        var sleep = await RunAsync(Runner(session), session);

        Assert.Equal(["cycle", "wait"], session.Actions);
        Assert.Equal(TimeSpan.FromSeconds(expectedSleep), sleep);
        Assert.Equal([Reports.Completion], session.Reports);
    }

    [Fact]
    public async Task Run_IgnoresTheBaselineCompletion()
    {
        var baseline = new CompletedCycle(
            "11111111-1111-1111-1111-111111111111", new DateTimeOffset(2026, 7, 20, 0, 0, 0, TimeSpan.Zero), "ok", 120);
        var session = new FakePilotSession { RunningProvider = Provider.Claude, DefaultActivity = Activity(Stale, baseline) };

        var sleep = await RunAsync(Runner(session), session);

        Assert.Null(sleep);
        Assert.Equal(FullLadder, session.Actions);
        Assert.DoesNotContain(Reports.Completion, session.Reports);
        Assert.DoesNotContain(Reports.Extend, session.Reports);
    }

    [Fact]
    public async Task Run_DoesNotCountStuckSignalsAsTime_WhileTheServerSeesActivity()
    {
        var session = new FakePilotSession { RunningProvider = Provider.Claude, DefaultActivity = Activity(Fresh) };
        for (var i = 0; i < 40; i++)
        {
            session.Signals.Enqueue(WaitResult.Stuck);
        }

        session.Signals.Enqueue(WaitResult.Sentinel(Cycle(60)));

        var sleep = await RunAsync(Runner(session), session);

        // A noisy burst on a live run must never reach the cycle cap, nor announce an extension.
        Assert.Equal(TimeSpan.FromSeconds(60), sleep);
        Assert.DoesNotContain("check-in", session.Actions);
        Assert.Empty(session.Reports);
    }

    [Fact]
    public async Task Run_ExtendsWhileActive_ThenClimbsTheLadderPastTheCycleCap()
    {
        var session = new FakePilotSession { RunningProvider = Provider.Claude, DefaultActivity = Activity(Fresh) };

        var sleep = await RunAsync(Runner(session), session);

        // Two extensions (20 -> 40 -> 60 minutes), then the cap hands over to the ladder.
        Assert.Null(sleep);
        Assert.Equal(["cycle", "wait", "wait", "wait", "check-in", "wait", "skip", "wait", "stop"], session.Actions);
        Assert.Single(session.Reports, r => r == Reports.Extend);
    }

    [Fact]
    public async Task Run_KeepsWaitingBeforeSkip_WhenActivityResumesAfterTheCheckIn()
    {
        var session = new FakePilotSession { RunningProvider = Provider.Claude };
        session.Signals.Enqueue(WaitResult.Stuck);
        session.Signals.Enqueue(WaitResult.Stuck);
        session.Signals.Enqueue(WaitResult.Sentinel(Cycle(30)));
        session.Activities.Enqueue(Activity(Stale)); // baseline
        session.Activities.Enqueue(Activity(Stale)); // after the first stuck
        session.Activities.Enqueue(Activity(Fresh)); // after the second stuck: active again

        var sleep = await RunAsync(Runner(session), session);

        Assert.Equal(["cycle", "wait", "check-in", "wait", "wait"], session.Actions);
        Assert.Equal(TimeSpan.FromSeconds(30), sleep);
    }

    [Fact]
    public async Task Run_PropagatesCancellation_DuringAProbeOrAReport()
    {
        var probing = new FakePilotSession { RunningProvider = Provider.Claude, BlockActivity = true };
        var reporting = new FakePilotSession { RunningProvider = Provider.Claude, DefaultActivity = Activity(Stale), BlockReport = true };

        foreach (var (session, started) in new[] { (probing, probing.ActivityStarted), (reporting, reporting.ReportStarted) })
        {
            using var cts = new CancellationTokenSource();
            var run = RunAsync(Runner(session), session, cts.Token);
            await started.Task;
            cts.Cancel();

            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => run);
            Assert.DoesNotContain("check-in", session.Actions);
        }
    }
}
