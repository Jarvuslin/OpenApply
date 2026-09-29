using System.Threading.Channels;
using JobPilot.Terminal.Common;
using Microsoft.Extensions.Hosting;

namespace JobPilot.Terminal.Pilot;

/// <summary>
/// The pilot's background loop: runs cycles while the pilot is running and parks while it is stopped. Saving the
/// settings or an API event wakes it, which ends an inter-cycle sleep early; a stop also aborts the live cycle.
/// </summary>
public sealed class PilotLoop : BackgroundService
{
    public const string ResumeReport = "Pilot resumed after the app restarted.";
    public const string StandingDownReport = "Pilot is stopped on the server - standing down.";

    private static readonly TimeSpan ErrorBackoff = TimeSpan.FromSeconds(30);

    // Lets Kestrel finish binding before a restarted host resumes its first cycle.
    private static readonly TimeSpan StartupResumeDelay = TimeSpan.FromSeconds(10);

    private readonly PilotStore store;
    private readonly IPilotSession session;
    private readonly ILogger<PilotLoop> logger;
    private readonly CycleRunner runner;

    // Capacity one coalesces a burst of wakes into one pending wake.
    private readonly Channel<bool> wakes = Channel.CreateBounded<bool>(
        new BoundedChannelOptions(1) { FullMode = BoundedChannelFullMode.DropWrite, SingleReader = true });

    private readonly Lock sync = new();
    private CancellationTokenSource? cycleCts;

    // With no reachable API a cycle is pure burn, so the loop backs off instead.
    private ExponentialBackoff apiBackoff = new(TimeSpan.FromSeconds(30), TimeSpan.FromMinutes(10));
    private volatile bool working;

    public PilotLoop(PilotStore store, IPilotSession session, ILogger<PilotLoop> logger)
    {
        this.store = store;
        this.session = session;
        this.logger = logger;
        runner = new CycleRunner(session);
        store.Changed += Wake;
    }

    /// <summary>Ends an inter-cycle sleep early. If the pilot is no longer running, also aborts the live cycle.</summary>
    public void Wake()
    {
        wakes.Writer.TryWrite(true);
        lock (sync)
        {
            // A wake that leaves the pilot running must never interrupt the agent mid-turn.
            if (store.Current is not { Running: true })
            {
                cycleCts?.Cancel();
            }
        }
    }

    public PilotStatus GetStatus()
    {
        var settings = store.Current;
        return new PilotStatus
        {
            Running = settings?.Running ?? false,
            Paired = settings is not null,
            Conducting = working && runner.Conducting,
            LastCycleAt = runner.LastCycleAt,
            LastCycleStatus = runner.LastCycleStatus?.ToString().ToLowerInvariant(),
            ConsecutiveTimeouts = runner.ConsecutiveRestarts,
        };
    }

    public override void Dispose()
    {
        store.Changed -= Wake;
        lock (sync)
        {
            cycleCts?.Dispose();
        }

        base.Dispose();
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await ResumeIfRunningAsync(stoppingToken);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            CancellationTokenSource cycle;
            lock (sync)
            {
                cycleCts?.Dispose();
                cycle = cycleCts = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
            }

            working = false;

            // Read only after publishing the token: a stop then either cancels this token or shows up in this read.
            var settings = store.Current;
            try
            {
                if (settings is not { Running: true })
                {
                    await wakes.Reader.ReadAsync(stoppingToken);
                    continue;
                }

                await RunOnceAsync(settings, cycle.Token, stoppingToken);
            }
            catch (OperationCanceledException) when (!stoppingToken.IsCancellationRequested)
            {
                // A stop aborts the agent's turn, unless it is the user's own session on the other provider.
                if (runner.Conducting && store.Current is not { Running: true })
                {
                    session.Interrupt();
                }
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Pilot cycle failed; backing off before retrying.");
                working = false;
                try
                {
                    await Task.Delay(ErrorBackoff, stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    return;
                }
            }
        }
    }

    private async Task RunOnceAsync(PilotSettings settings, CancellationToken ct, CancellationToken stoppingToken)
    {
        // One probe gates the cycle on the server's run-state and gives the runner its completion baseline.
        var activity = await session.GetActivityAsync(ct);
        if (activity is null)
        {
            await SleepOrWakeAsync(apiBackoff.Next(), ct);
            return;
        }

        apiBackoff.Reset();
        if (!activity.Running)
        {
            // Stopped on the server: mirror it locally so the loop parks. That save cancels ct, so report on stoppingToken.
            store.SetRunning(false);
            await session.ReportAsync(StandingDownReport, stoppingToken);
            return;
        }

        // This cycle reads the current settings, which covers any wake that came before it.
        wakes.Reader.TryRead(out _);

        working = true;
        var sleep = await runner.RunAsync(settings, activity, ct);
        if (sleep is { } duration && duration > TimeSpan.Zero)
        {
            await SleepOrWakeAsync(duration, ct);
        }
    }

    private async Task ResumeIfRunningAsync(CancellationToken stoppingToken)
    {
        if (store.Current is not { Running: true })
        {
            return;
        }

        await session.DelayAsync(StartupResumeDelay, stoppingToken);
        var owed = CycleRunner.OwedBreak(await session.GetActivityAsync(stoppingToken), DateTimeOffset.UtcNow);
        if (owed <= TimeSpan.Zero)
        {
            await session.ReportAsync(ResumeReport, stoppingToken);
            return;
        }

        await session.ReportAsync($"{ResumeReport} Waiting out the planned break until {DateTimeOffset.UtcNow + owed:u} first.", stoppingToken);
        await SleepOrWakeAsync(owed, stoppingToken);
    }

    /// <summary>Sleeps until the duration passes or a wake arrives. Throws when <paramref name="ct"/> cancels.</summary>
    private async Task SleepOrWakeAsync(TimeSpan duration, CancellationToken ct)
    {
        // A wake during the cycle had no sleep to end, so its pending wake ends this one before it starts.
        if (wakes.Reader.TryRead(out _))
        {
            return;
        }

        using var sleepCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var woken = wakes.Reader.WaitToReadAsync(sleepCts.Token).AsTask();
        var slept = session.DelayAsync(duration, sleepCts.Token);
        await Task.WhenAny(woken, slept);
        await sleepCts.CancelAsync();
        ct.ThrowIfCancellationRequested();
    }
}
