namespace JobPilot.Terminal.Pilot;

/// <summary>
/// Runs one cycle and recovers a stuck run by climbing check-in, skip, then restart. It returns the inter-cycle
/// sleep instead of sleeping, so the loop can cut the sleep short on a wake.
/// </summary>
/// <param name="checkInterval">Tests pass one at least as long as every wait, so each wait is a single slice.</param>
internal sealed class CycleRunner(IPilotSession session, TimeSpan? checkInterval = null)
{
    public const int MinSleepSeconds = 15;
    public const int MaxSleepSeconds = 21600;

    // Server-side activity newer than this means the run is working, not stuck.
    public static readonly TimeSpan ActiveWindow = TimeSpan.FromMinutes(5);

    private static readonly TimeSpan SentinelTimeout = TimeSpan.FromMinutes(20);
    private static readonly TimeSpan CheckInGrace = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan BackoffDelay = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan StartupGrace = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan MismatchPoll = TimeSpan.FromSeconds(5);

    // A run that keeps showing activity still hands over to the ladder after this long.
    private static readonly TimeSpan MaxCycleWait = TimeSpan.FromMinutes(60);

    // Back off only after this many restarts or exits in a row, so a broken install cannot hot-loop.
    private const int BackoffThreshold = 3;

    // How often a wait asks the server for a completion the TUI may have garbled.
    private readonly TimeSpan checkInterval = checkInterval ?? TimeSpan.FromMinutes(2);

    // The server's newest completion before this cycle, so the previous cycle's completion never ends this one.
    private CompletedCycle? baseline;

    private TimeSpan totalWaited;
    private bool extensionReported;

    /// <summary>Reset by any finished cycle.</summary>
    public int ConsecutiveRestarts { get; private set; }

    /// <summary>Sessions that died on their own mid-wait; reset by any finished cycle.</summary>
    public int ConsecutiveExits { get; private set; }

    public DateTimeOffset? LastCycleAt { get; private set; }

    public CycleStatus? LastCycleStatus { get; private set; }

    /// <summary>False while paused because the user runs the other provider.</summary>
    public bool Conducting { get; private set; }

    /// <summary>The rest of the last inter-cycle break, so a host restart does not skip it.</summary>
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

    /// <summary>Returns the sleep before the next cycle, or null to go again right away.</summary>
    /// <param name="activity">The probe taken just before; its last cycle is the baseline for spotting a garbled finish.</param>
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
        var (finished, sleep) = await WaitToFinishAsync(SentinelTimeout, ct);
        return finished ? sleep : await ClimbLadderAsync(settings, ct);
    }

    private async Task<TimeSpan?> ClimbLadderAsync(PilotSettings settings, CancellationToken ct)
    {
        // No server check between rungs: every unfinished wait has just checked for a completion.
        (Directive Directive, string Report)[] rungs = [(Directive.CheckIn, Reports.CheckIn), (Directive.Skip, Reports.Skip)];
        foreach (var (directive, report) in rungs)
        {
            await session.ReportAsync(report, ct);
            await session.SendDirectiveAsync(settings, directive, ct);
            var (finished, sleep) = await WaitToFinishAsync(CheckInGrace, ct);
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

    /// <summary>Finished with a sleep on a sentinel, finished with none when the session died, else not finished.</summary>
    private async Task<(bool Finished, TimeSpan? Sleep)> WaitToFinishAsync(TimeSpan quietBudget, CancellationToken ct)
    {
        var result = await WaitAsync(quietBudget, ct);
        if (result.Outcome is WaitOutcome.Sentinel)
        {
            ConsecutiveRestarts = 0;
            ConsecutiveExits = 0;
            LastCycleAt = DateTimeOffset.UtcNow;
            LastCycleStatus = result.Cycle.Status;
            return (true, TimeSpan.FromSeconds(ClampSleep(result.Cycle.SleepSeconds)));
        }

        if (result.Outcome is not WaitOutcome.SessionExited)
        {
            return (false, null);
        }

        // The next cycle restarts the session, but a CLI that keeps dying at startup (broken install or sign-in)
        // backs off instead of restarting every few seconds.
        ConsecutiveExits++;
        if (ConsecutiveExits >= BackoffThreshold)
        {
            await session.ReportAsync(Reports.ExitBackoff, ct);
            await session.DelayAsync(BackoffDelay, ct);
            ConsecutiveExits = 0;
        }

        return (true, null);
    }

    /// <summary>
    /// Waits in slices, checking the server after each. A garbled completion ends the wait and fresh activity extends
    /// it, up to <see cref="MaxCycleWait"/> per cycle; otherwise it returns after the quiet budget or a stuck signal.
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

    /// <summary>A server-recorded completion newer than the baseline. Compares server values only, never clocks.</summary>
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

    /// <summary>Journal entries the user's phone hears about, so keep the wording stable.</summary>
    internal static class Reports
    {
        public const string CheckIn = "Pilot orchestrator: the current run looks stuck - sent the agent a check-in reminder.";
        public const string Skip = "Pilot orchestrator: still stuck after the check-in - told the agent to set the task aside as failed and move on.";
        public const string Restart = "Pilot orchestrator: the agent stopped responding - restarted its session; the unfinished task will be picked up again automatically.";
        public const string Backoff = "Pilot orchestrator: 3 runs in a row got stuck - taking a 30-minute break before trying again.";
        public const string ExitBackoff = "Pilot orchestrator: the provider CLI keeps exiting right after startup - check its install and sign-in - taking a 30-minute break.";
        public const string Extend = "Pilot orchestrator: this run is taking longer than usual but is still making progress - giving it more time.";
        public const string Completion = "Pilot orchestrator: read this run's result from the server because the terminal output was unreadable.";
    }
}
