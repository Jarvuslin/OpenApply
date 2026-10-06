using OpenApply.Terminal.Providers;

namespace OpenApply.Terminal.Pilot;

public enum WaitOutcome
{
    Sentinel,
    Timeout,
    SessionExited,
    Stuck,
}

public readonly record struct WaitResult(WaitOutcome Outcome, CycleResult Cycle = default)
{
    public static readonly WaitResult Timeout = new(WaitOutcome.Timeout);
    public static readonly WaitResult Exited = new(WaitOutcome.SessionExited);
    public static readonly WaitResult Stuck = new(WaitOutcome.Stuck);

    public static WaitResult Sentinel(CycleResult cycle) => new(WaitOutcome.Sentinel, cycle);
}

/// <summary>CheckIn asks the agent to release its claim; Skip makes it fail the claimed task. Both end the cycle.</summary>
public enum Directive
{
    CheckIn,
    Skip,
}

/// <summary>The loop's one seam to the terminal, the API, and the clock, so tests can script a whole cycle.</summary>
public interface IPilotSession
{
    /// <summary>Null when no session is running.</summary>
    Provider? RunningProvider { get; }

    void Start(PilotSettings settings);

    Task SendCycleAsync(PilotSettings settings, CancellationToken ct);

    Task SendDirectiveAsync(PilotSettings settings, Directive directive, CancellationToken ct);

    Task<WaitResult> WaitForSignalAsync(TimeSpan timeout, CancellationToken ct);

    void Stop();

    /// <summary>Aborts the agent's current turn but keeps the session.</summary>
    void Interrupt();

    Task DelayAsync(TimeSpan duration, CancellationToken ct);

    /// <summary>Null when the probe fails. This and <see cref="ReportAsync"/> throw only on the caller's cancellation.</summary>
    Task<PilotActivity?> GetActivityAsync(CancellationToken ct);

    Task ReportAsync(string summary, CancellationToken ct);
}
