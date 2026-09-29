namespace JobPilot.Terminal.Pilot;

public enum WaitOutcome
{
    Sentinel,
    Timeout,
    SessionExited,

    /// <summary>A stuck heuristic fired before the timeout.</summary>
    Stuck,
}

public readonly record struct WaitResult(WaitOutcome Outcome, CycleResult Cycle = default)
{
    public static readonly WaitResult Timeout = new(WaitOutcome.Timeout);
    public static readonly WaitResult Exited = new(WaitOutcome.SessionExited);
    public static readonly WaitResult Stuck = new(WaitOutcome.Stuck);

    public static WaitResult Sentinel(CycleResult cycle) => new(WaitOutcome.Sentinel, cycle);
}

/// <summary>An instruction sent to a run that looks stuck.</summary>
public enum Directive
{
    /// <summary>Asks the agent to release its claim and end the cycle.</summary>
    CheckIn,

    /// <summary>Makes the agent fail the claimed task and end the cycle.</summary>
    Skip,
}

/// <summary>Everything the pilot loop does to the outside world, behind one seam so the loop is testable.</summary>
public interface IPilotSession
{
    /// <summary>Provider of the running session, or null when stopped.</summary>
    string? RunningProvider { get; }

    void Start(PilotSettings settings);

    /// <summary>Clears the conversation, then sends the pilot skill command.</summary>
    Task SendCycleAsync(PilotSettings settings, CancellationToken ct);

    Task SendDirectiveAsync(PilotSettings settings, Directive directive, CancellationToken ct);

    /// <summary>Waits for a cycle sentinel, a stuck signal, the session exiting, or the timeout.</summary>
    Task<WaitResult> WaitForSignalAsync(TimeSpan timeout, CancellationToken ct);

    void Stop();

    /// <summary>Sends Esc to abort the agent's current turn, leaving the session alive.</summary>
    void Interrupt();

    Task DelayAsync(TimeSpan duration, CancellationToken ct);

    /// <summary>Null when the probe fails. Throws only on caller cancellation.</summary>
    Task<PilotActivity?> GetActivityAsync(CancellationToken ct);

    /// <summary>Journals an orchestrator action. Throws only on caller cancellation.</summary>
    Task ReportAsync(string summary, CancellationToken ct);
}
