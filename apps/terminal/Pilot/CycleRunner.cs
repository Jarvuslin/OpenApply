namespace JobPilot.Terminal.Pilot;

/// <summary>
/// Runs one pilot cycle: start the session if needed, send the cycle, wait for it to finish, and recover a stuck
/// run by climbing check-in, skip, then restart. It returns the inter-cycle sleep instead of sleeping, so the loop
/// can end the sleep early on a wake.
/// </summary>
internal sealed class CycleRunner
{
    public static readonly TimeSpan SentinelTimeout = TimeSpan.FromMinutes(20);
    public static readonly TimeSpan CheckInGrace = TimeSpan.FromMinutes(5);
    public static readonly TimeSpan BackoffDelay = TimeSpan.FromMinutes(30);
    public static readonly TimeSpan StartupGrace = TimeSpan.FromSeconds(15);
    public static readonly TimeSpan MismatchPoll = TimeSpan.FromSeconds(5);

    // How often a wait asks the server for a completion the TUI may have garbled.
    public static readonly TimeSpan CompletionCheckInterval = TimeSpan.FromMinutes(2);

    // Server-side activity newer than this means the run is working, not stuck.
    public static readonly TimeSpan ActiveWindow = TimeSpan.FromMinutes(5);

    // A cycle that keeps showing activity still hands over to the ladder after this long.
    public static readonly TimeSpan MaxCycleWait = TimeSpan.FromMinutes(60);

    // Back off only after this many restarts or exits in a row, so a broken install cannot hot-loop.
    public const int BackoffThreshold = 3;

    public const int MinSleepSeconds = 15;
    public const int MaxSleepSeconds = 21600;

    private readonly IPilotSession session;
    private readonly TimeSpan checkInterval;

    // The server's newest completion before this cycle started, so the previous cycle's completion never ends this one.
    private CompletedCycle? baseline;

    private TimeSpan totalWaited;
    private bool extensionReported;

    /// <param name="checkInterval">Tests pass one at least as long as every wait, so each wait is a single slice.</param>
    public CycleRunner(IPilotSession session, TimeSpan? checkInterval = null)
    {
        this.session = session;
        this.checkInterval = checkInterval ?? CompletionCheckInterval;
    }

    /// <summary>Reset by any finished cycle.</summary>
    public int ConsecutiveRestarts { get; private set; }

    /// <summary>Sessions that died on their own mid-wait; reset by any finished cycle.</summary>
    public int ConsecutiveExits { get; private set; }

    public DateTimeOffset? LastCycleAt { get; private set; }

    public CycleStatus? LastCycleStatus { get; private set; }

    /// <summary>False while paused because the user runs the other provider.</summary>
    public bool Conducting { get; private set; }

    /// <summary>A still-owed inter-cycle break after a host restart, so a restart does not skip it.</summary>
    public static TimeSpan OwedBreak(PilotActivity? activity, DateTimeOffset now)
    {
        if (activity?.LastCycle is not { } last)
        {
            return TimeSpan.Zero;
        }

        var planned = TimeSpan.FromSeconds(ClampSleep(last.SleepSeconds ?? MinSleepSeconds));
        var remaining = planned - (now - last.CompletedAt);
        if (remaining <= TimeSpan.Zero)
        {
            return TimeSpan.Zero;
        }

        return remaining > planned ? planned : remaining;
    }

    /// <summary>Runs one cycle. Returns the sleep before the next one, or null to go again right away.</summary>
    /// <param name="activity">The server probe taken just before; the baseline for spotting a garbled finish.</param>
    public async Task<TimeSpan?> RunAsync(PilotSettings settings, PilotActivity activity, CancellationToken ct)
    {
        // Never fight a user who launched the other provider by hand: pause instead of killing their session.
        var running = session.RunningProvider;
        if (running is not null && running != settings.Provider)
        {
            Conducting = false;
            await session.DelayAsync(MismatchPoll, ct);
            return null;
        }

        Conducting = true;
        if (running is null)
        {
            session.Start(settings);
            await session.DelayAsync(StartupGrace, ct);
        }

        baseline = activity.LastCycle;

        totalWaited = TimeSpan.Zero;
        extensionReported = false;

        await session.SendCycleAsync(settings, ct);
        var (finished, sleep) = await FinishAsync(await WaitAsync(SentinelTimeout, ct), ct);
        return finished ? sleep : await ClimbLadderAsync(settings, ct);
    }

    private async Task<TimeSpan?> ClimbLadderAsync(PilotSettings settings, CancellationToken ct)
    {
        // No server check between rungs: every unfinished WaitAsync has just checked for a completion.
        (Directive Directive, string Report)[] rungs = [(Directive.CheckIn, Reports.CheckIn), (Directive.Skip, Reports.Skip)];
        foreach (var (directive, report) in rungs)
        {
            await session.ReportAsync(report, ct);
            await session.SendDirectiveAsync(settings, directive, ct);
            var (finished, sleep) = await FinishAsync(await WaitAsync(CheckInGrace, ct), ct);
            if (finished)
            {
                return sleep;
            }
        }

        ConsecutiveRestarts++;
        await session.ReportAsync(Reports.Restart, ct);
        session.Stop();
        if (ConsecutiveRestarts >= BackoffThreshold)
        {
            await session.ReportAsync(Reports.Backoff, ct);
            await session.DelayAsync(BackoffDelay, ct);
        }

        return null;
    }

    /// <summary>
    /// Waits in slices, checking the server after each. A garbled completion ends the wait; fresh activity keeps
    /// waiting (up to <see cref="MaxCycleWait"/> per cycle). Otherwise it returns after a quiet budget or a stuck signal.
    /// </summary>
    private async Task<WaitResult> WaitAsync(TimeSpan quietBudget, CancellationToken ct)
    {
        var slice = checkInterval < quietBudget ? checkInterval : quietBudget;
        var quiet = TimeSpan.Zero;

        while (true)
        {
            var result = await session.WaitForSignalAsync(slice, ct);
            if (result.Outcome is WaitOutcome.Sentinel or WaitOutcome.SessionExited)
            {
                return result;
            }

            // A stuck signal returns the moment it fires; counting it as elapsed would let one noisy burst spend
            // the whole cycle budget in seconds.
            if (result.Outcome is WaitOutcome.Timeout)
            {
                totalWaited += slice;
                quiet += slice;
            }

            var activity = await session.GetActivityAsync(ct);
            if (await FindNewCompletionAsync(activity, ct) is { } cycle)
            {
                return WaitResult.Sentinel(cycle);
            }

            if (activity?.LastActivityAt is { } at && DateTimeOffset.UtcNow - at < ActiveWindow)
            {
                if (totalWaited >= MaxCycleWait)
                {
                    return result;
                }

                if (totalWaited >= SentinelTimeout && !extensionReported)
                {
                    await session.ReportAsync(Reports.Extend, ct);
                    extensionReported = true;
                }

                quiet = TimeSpan.Zero;
            }
            else if (quiet >= quietBudget || result.Outcome is WaitOutcome.Stuck)
            {
                return result;
            }
        }
    }

    /// <summary>Finished with a sleep on a sentinel, finished with none when the session died, else not finished.</summary>
    private async Task<(bool Finished, TimeSpan? Sleep)> FinishAsync(WaitResult result, CancellationToken ct)
    {
        switch (result.Outcome)
        {
            case WaitOutcome.Sentinel:
                return (true, Complete(result.Cycle));

            case WaitOutcome.SessionExited:
                // The next cycle restarts the session. A CLI that keeps dying at startup (broken install or
                // sign-in) backs off instead of restarting every few seconds.
                ConsecutiveExits++;
                if (ConsecutiveExits >= BackoffThreshold)
                {
                    await session.ReportAsync(Reports.ExitBackoff, ct);
                    await session.DelayAsync(BackoffDelay, ct);
                    ConsecutiveExits = 0;
                }

                return (true, null);

            default:
                return (false, null);
        }
    }

    private TimeSpan Complete(CycleResult cycle)
    {
        ConsecutiveRestarts = 0;
        ConsecutiveExits = 0;
        LastCycleAt = DateTimeOffset.UtcNow;
        LastCycleStatus = cycle.Status;
        return TimeSpan.FromSeconds(ClampSleep(cycle.SleepSeconds));
    }

    /// <summary>A completion newer than the baseline, as a cycle result. Compares server values only, never clocks.</summary>
    private async Task<CycleResult?> FindNewCompletionAsync(PilotActivity? activity, CancellationToken ct)
    {
        if (activity?.LastCycle is not { } latest)
        {
            return null;
        }

        var isNew = baseline is null
            || latest.CycleId != baseline.CycleId
            || latest.CompletedAt > baseline.CompletedAt;
        if (!isNew)
        {
            return null;
        }

        baseline = latest;
        await session.ReportAsync(Reports.Completion, ct);

        // A completion with no sleep hint is a skill bug; the minimum keeps the next cycle coming soon.
        return new CycleResult(SentinelParser.ParseStatus(latest.Status), latest.SleepSeconds ?? MinSleepSeconds);
    }

    private static int ClampSleep(int seconds) => Math.Clamp(seconds, MinSleepSeconds, MaxSleepSeconds);

    /// <summary>What the user's phone hears. The wording is user-facing, so keep it stable.</summary>
    internal static class Reports
    {
        public const string CheckIn = "Pilot orchestrator: the current run looks stuck - sent the agent a check-in reminder.";
        public const string Skip = "Pilot orchestrator: still stuck after the check-in - told the agent to set the task aside as failed and move on.";
        public const string Restart = "Pilot orchestrator: the agent stopped responding - restarted its session; the unfinished task will be picked up again automatically.";
        public const string Backoff = "Pilot orchestrator: 3 runs in a row got stuck - taking a 30-minute break before trying again.";
        public const string ExitBackoff = "Pilot orchestrator: the provider CLI keeps exiting right after startup - check its install and sign-in - taking a 30-minute break.";
        public const string Extend = "Pilot orchestrator: this run is taking longer than usual but is still making progress - giving it more time.";

        // Routine recovery, not a fault: the server-recorded cycle is intact.
        public const string Completion = "Pilot orchestrator: read this run's result from the server because the terminal output was unreadable.";
    }
}
