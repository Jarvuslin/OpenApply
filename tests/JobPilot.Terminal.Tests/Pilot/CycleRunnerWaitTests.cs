using JobPilot.Terminal.Pilot;
using Xunit;
using static JobPilot.Terminal.Tests.Builders;
using static JobPilot.Terminal.Tests.CycleRunnerTests;
using Reports = JobPilot.Terminal.Pilot.CycleRunner.Reports;

namespace JobPilot.Terminal.Tests;

/// <summary>How a wait uses the server: a garbled finish ends it, fresh activity extends it.</summary>
public class CycleRunnerWaitTests
{
    private static readonly string[] FullLadder = ["cycle", "wait", "check-in", "wait", "skip", "wait", "stop"];

    [Theory]
    [InlineData(120, 120)]
    [InlineData(null, CycleRunner.MinSleepSeconds)]
    public async Task Run_Finishes_WhenTheServerRecordsACompletionTheTerminalGarbled(int? sleepHint, int expectedSleep)
    {
        var session = new FakePilotSession { RunningProvider = "claude", DefaultActivity = Activity(Stale, Completed(sleepHint)) };
        session.Activities.Enqueue(Activity(Stale)); // baseline: nothing finished yet

        var sleep = await RunAsync(Runner(session), session);

        Assert.Equal(["cycle", "wait"], session.Actions);
        Assert.Equal(TimeSpan.FromSeconds(expectedSleep), sleep);
        Assert.Equal([Reports.Completion], session.Reports);
    }

    [Fact]
    public async Task Run_FinishesInsteadOfSkipping_WhenTheServerConfirmsACompletionFirst()
    {
        var session = new FakePilotSession { RunningProvider = "claude" };
        session.Signals.Enqueue(WaitResult.Stuck);
        session.Signals.Enqueue(WaitResult.Stuck);
        session.Activities.Enqueue(Activity(Stale));                // baseline
        session.Activities.Enqueue(Activity(Stale));                // after the first stuck
        session.Activities.Enqueue(Activity(Stale));                // check-in guard
        session.Activities.Enqueue(Activity(Stale));                // after the second stuck
        session.Activities.Enqueue(Activity(Stale, Completed(90))); // skip guard: finished

        var sleep = await RunAsync(Runner(session), session);

        Assert.Equal(["cycle", "wait", "check-in", "wait"], session.Actions);
        Assert.Equal(TimeSpan.FromSeconds(90), sleep);
        Assert.Equal([Reports.CheckIn, Reports.Completion], session.Reports);
    }

    [Fact]
    public async Task Run_IgnoresTheBaselineCompletion()
    {
        var baseline = new CompletedCycle(
            "11111111-1111-1111-1111-111111111111", new DateTimeOffset(2026, 7, 20, 0, 0, 0, TimeSpan.Zero), "ok", 120);
        var session = new FakePilotSession { RunningProvider = "claude", DefaultActivity = Activity(Stale, baseline) };

        var sleep = await RunAsync(Runner(session), session);

        Assert.Null(sleep);
        Assert.Equal(FullLadder, session.Actions);
        Assert.DoesNotContain(Reports.Completion, session.Reports);
    }

    [Fact]
    public async Task Run_KeepsWaiting_WhileTheServerSeesActivity()
    {
        var session = new FakePilotSession { RunningProvider = "claude", DefaultActivity = Activity(Fresh) };
        session.Signals.Enqueue(WaitResult.Timeout);
        session.Signals.Enqueue(WaitResult.Sentinel(Cycle(20)));

        var sleep = await RunAsync(Runner(session), session);

        Assert.Equal(["cycle", "wait", "wait"], session.Actions);
        Assert.Equal(TimeSpan.FromSeconds(20), sleep);
        Assert.Equal([Reports.Extend], session.Reports);
    }

    [Fact]
    public async Task Run_DoesNotCountStuckSignalsAsTime_WhileTheServerSeesActivity()
    {
        var session = new FakePilotSession { RunningProvider = "claude", DefaultActivity = Activity(Fresh) };
        for (var i = 0; i < 40; i++)
        {
            session.Signals.Enqueue(WaitResult.Stuck);
        }

        session.Signals.Enqueue(WaitResult.Sentinel(Cycle(60)));

        var sleep = await RunAsync(Runner(session), session);

        // A noisy burst on a live run must never reach MaxCycleWait, nor announce an extension.
        Assert.Equal(TimeSpan.FromSeconds(60), sleep);
        Assert.DoesNotContain("check-in", session.Actions);
        Assert.Empty(session.Reports);
    }

    [Fact]
    public async Task Run_ClimbsTheLadder_WhenActivityIsStale()
    {
        var session = new FakePilotSession { RunningProvider = "claude", DefaultActivity = Activity(Stale) };

        await RunAsync(Runner(session), session);

        Assert.Equal(FullLadder, session.Actions);
        Assert.DoesNotContain(Reports.Extend, session.Reports);
    }

    [Fact]
    public async Task Run_ClimbsTheLadder_WhenActiveButPastTheCycleCap()
    {
        var session = new FakePilotSession { RunningProvider = "claude", DefaultActivity = Activity(Fresh) };

        var sleep = await RunAsync(Runner(session), session);

        // Two extensions (20 -> 40 -> 60 minutes), then the cap hands over to the ladder.
        Assert.Null(sleep);
        Assert.Equal(["cycle", "wait", "wait", "wait", "check-in", "wait", "skip", "wait", "stop"], session.Actions);
        Assert.Single(session.Reports, r => r == Reports.Extend);
    }

    [Fact]
    public async Task Run_KeepsWaitingBeforeSkip_WhenActivityResumesAfterTheCheckIn()
    {
        var session = new FakePilotSession { RunningProvider = "claude" };
        session.Signals.Enqueue(WaitResult.Stuck);
        session.Signals.Enqueue(WaitResult.Stuck);
        session.Signals.Enqueue(WaitResult.Sentinel(Cycle(30)));
        session.Activities.Enqueue(Activity(Stale)); // baseline
        session.Activities.Enqueue(Activity(Stale)); // after the first stuck
        session.Activities.Enqueue(Activity(Stale)); // check-in guard
        session.Activities.Enqueue(Activity(Fresh)); // after the second stuck: active again

        var sleep = await RunAsync(Runner(session), session);

        Assert.Equal(["cycle", "wait", "check-in", "wait", "wait"], session.Actions);
        Assert.Equal(TimeSpan.FromSeconds(30), sleep);
    }

    [Fact]
    public async Task Run_PropagatesCancellation_DuringAProbeOrAReport()
    {
        var probing = new FakePilotSession { RunningProvider = "claude", BlockActivity = true };
        var reporting = new FakePilotSession { RunningProvider = "claude", DefaultActivity = Activity(Stale), BlockReport = true };

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
