using JobPilot.Terminal.Pilot;

namespace JobPilot.Terminal.Tests;

/// <summary>A scriptable <see cref="IPilotSession"/> that records what the pilot loop does.</summary>
internal sealed class FakePilotSession : IPilotSession
{
    // The loop records from a background thread while the test asserts, so the logs are read as snapshots.
    private readonly Lock sync = new();
    private readonly List<string> actions = [];
    private readonly List<string> reports = [];

    public List<string> Actions => Snapshot(actions);

    /// <summary>Journal summaries, kept apart from Actions so sequence asserts stay short.</summary>
    public List<string> Reports => Snapshot(reports);

    /// <summary>Results of successive waits; an empty queue times out.</summary>
    public Queue<WaitResult> Signals { get; } = new();

    /// <summary>Results of successive probes; an empty queue returns <see cref="DefaultActivity"/>.</summary>
    public Queue<PilotActivity?> Activities { get; } = new();

    /// <summary>Null by default: a failed probe, so the completion fallback stays off.</summary>
    public PilotActivity? DefaultActivity { get; set; }

    public int ActivityProbes;

    public bool BlockActivity { get; set; }

    public TaskCompletionSource ActivityStarted { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

    public bool BlockReport { get; set; }

    public TaskCompletionSource ReportStarted { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

    /// <summary>Blocks delays over a minute until cancelled, like a real inter-cycle sleep.</summary>
    public bool BlockSleep { get; set; }

    /// <summary>Blocks a wait with nothing scripted until cancelled, instead of timing out.</summary>
    public bool BlockWhenUnscripted { get; set; }

    public string? RunningProvider { get; set; }

    public void ClearActions()
    {
        lock (sync)
        {
            actions.Clear();
        }
    }

    /// <summary>The next probe result; the runner tests pass it as the cycle's baseline, like the loop does.</summary>
    public PilotActivity? NextActivity()
    {
        lock (sync)
        {
            return Activities.Count > 0 ? Activities.Dequeue() : DefaultActivity;
        }
    }

    public void Start(PilotSettings settings)
    {
        Record("start");
        RunningProvider = settings.Provider;
    }

    public Task SendCycleAsync(PilotSettings settings, CancellationToken ct)
    {
        Record("cycle");
        return Task.CompletedTask;
    }

    public Task SendDirectiveAsync(PilotSettings settings, Directive directive, CancellationToken ct)
    {
        Record(directive == Directive.CheckIn ? "check-in" : "skip");
        return Task.CompletedTask;
    }

    public async Task<WaitResult> WaitForSignalAsync(TimeSpan timeout, CancellationToken ct)
    {
        Record("wait");
        if (Signals.TryDequeue(out var result))
        {
            return result;
        }

        if (BlockWhenUnscripted)
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, ct);
        }

        return WaitResult.Timeout;
    }

    public void Stop()
    {
        Record("stop");
        RunningProvider = null;
    }

    public void Interrupt() => Record("interrupt");

    public async Task DelayAsync(TimeSpan duration, CancellationToken ct)
    {
        Record($"sleep:{(int)duration.TotalSeconds}");
        if (BlockSleep && duration > TimeSpan.FromMinutes(1))
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, ct);
        }
    }

    public async Task<PilotActivity?> GetActivityAsync(CancellationToken ct)
    {
        Interlocked.Increment(ref ActivityProbes);
        ActivityStarted.TrySetResult();
        if (BlockActivity)
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, ct);
        }

        return NextActivity();
    }

    public async Task ReportAsync(string summary, CancellationToken ct)
    {
        lock (sync)
        {
            reports.Add(summary);
        }

        ReportStarted.TrySetResult();
        if (BlockReport)
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, ct);
        }
    }

    private void Record(string action)
    {
        lock (sync)
        {
            actions.Add(action);
        }
    }

    private List<string> Snapshot(List<string> list)
    {
        lock (sync)
        {
            return [.. list];
        }
    }
}
