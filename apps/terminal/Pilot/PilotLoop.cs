using System.Threading.Channels;

namespace OpenApply.Terminal.Pilot;

internal sealed record PilotScheduleResult(int Enqueued);
public interface IPilotScheduler
{
    Task<PilotActivity?> GetActivityAsync(PilotSettings settings, CancellationToken ct);
    Task<int> ScheduleAsync(PilotSettings settings, CancellationToken ct);
}

/// <summary>Optional code-only admission scheduler; only QueueRuntime can execute admitted work.</summary>
public sealed class PilotLoop : BackgroundService
{
    private readonly PilotStore store;
    private readonly IPilotScheduler scheduler;
    private readonly ILogger<PilotLoop> logger;
    private readonly Channel<bool> wakes = Channel.CreateBounded<bool>(new BoundedChannelOptions(1)
        { FullMode = BoundedChannelFullMode.DropWrite, SingleReader = true });
    private readonly Lock sync = new();
    private CancellationTokenSource? cycle;
    private DateTimeOffset? lastCycleAt;
    private string? lastCycleStatus;

    public PilotLoop(PilotStore store, IPilotScheduler scheduler, ILogger<PilotLoop> logger)
    {
        this.store = store;
        this.scheduler = scheduler;
        this.logger = logger;
        store.Changed += Wake;
    }

    public void Wake()
    {
        wakes.Writer.TryWrite(true);
        lock (sync) { if (store.Current is not { Running: true }) cycle?.Cancel(); }
    }

    public PilotStatus GetStatus()
    {
        lock (sync) return new()
        {
            Running = store.Current?.Running ?? false, Paired = store.Current is not null,
            Conducting = false, LastCycleAt = lastCycleAt, LastCycleStatus = lastCycleStatus, ConsecutiveTimeouts = 0,
            Mode = "queue_scheduler",
        };
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            using var iteration = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
            lock (sync) cycle = iteration;
            try
            {
                var settings = store.Current;
                if (settings is not { Running: true })
                {
                    await wakes.Reader.ReadAsync(stoppingToken);
                    continue;
                }
                wakes.Reader.TryRead(out _);
                var activity = await scheduler.GetActivityAsync(settings, iteration.Token);
                if (activity is { Running: false }) { store.SetRunning(false); continue; }
                if (activity is not null)
                {
                    var count = await scheduler.ScheduleAsync(settings, iteration.Token);
                    lock (sync) { lastCycleAt = DateTimeOffset.UtcNow; lastCycleStatus = count > 0 ? "queued" : "empty"; }
                }
                await SleepOrWakeAsync(iteration.Token);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch (OperationCanceledException) { }
            catch (Exception ex)
            {
                lock (sync) { lastCycleAt = DateTimeOffset.UtcNow; lastCycleStatus = "error"; }
                logger.LogWarning("Pilot queue scheduling failed ({FailureType}).", ex.GetType().Name);
                try { await SleepOrWakeAsync(stoppingToken); } catch (OperationCanceledException) { return; }
            }
            finally { lock (sync) { if (cycle == iteration) cycle = null; } }
        }
    }

    private async Task SleepOrWakeAsync(CancellationToken ct)
    {
        using var wait = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var wake = wakes.Reader.WaitToReadAsync(wait.Token).AsTask();
        var delay = Task.Delay(TimeSpan.FromSeconds(30), wait.Token);
        await Task.WhenAny(wake, delay);
        await wait.CancelAsync();
        ct.ThrowIfCancellationRequested();
    }

    public override void Dispose()
    {
        store.Changed -= Wake;
        base.Dispose();
    }
}
