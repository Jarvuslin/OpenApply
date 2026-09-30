using System.Threading.Channels;
using JobPilot.Terminal.Providers;
using JobPilot.Terminal.Sessions;

namespace JobPilot.Terminal.Pilot;

public sealed class PilotSession : IPilotSession, IDisposable
{
    private const string PilotSkill = "pilot";
    private const string ClearCommand = "/clear";
    private const int Cols = 220;
    private const int Rows = 50;

    // Redraw time between /clear and the cycle command landing on the fresh prompt.
    private static readonly TimeSpan ClearSettle = TimeSpan.FromSeconds(2);

    // Without the cycle detail spelled out, /api/pilot/activity can't read the entry as a completion.
    private const string ErrorExit =
        "journal the error batch (system + cycle with detail:{\"status\":\"error\",\"sleepSeconds\":300}), "
        + "and print the error sentinel.";

    private const string CheckInText = "Checking in: you appear stuck. Release your claim, " + ErrorExit;
    private const string SkipText = "Stop the current action. Fail the claimed task, " + ErrorExit;

    private readonly TerminalSession terminal;
    private readonly PilotStore store;
    private readonly PilotApi api;
    private readonly ILogger<PilotSession> logger;
    private readonly SentinelParser sentinels = new();
    private readonly StuckDetector stuck = new();

    // A cycle, or null for a stuck signal, in one channel so a wait sees whichever comes first. Not single-writer:
    // the PTY thread writes while the loop re-queues sentinels it drained.
    private readonly Channel<CycleResult?> signals = Channel.CreateUnbounded<CycleResult?>(new UnboundedChannelOptions { SingleReader = true });

    public PilotSession(TerminalSession terminal, PilotStore store, PilotApi api, ILogger<PilotSession> logger)
    {
        this.terminal = terminal;
        this.store = store;
        this.api = api;
        this.logger = logger;
        terminal.Output += OnOutput;
    }

    public Provider? RunningProvider => terminal.IsRunning ? terminal.ActiveProvider : null;

    public void Start(PilotSettings settings) =>
        terminal.Start(settings.Provider, Cols, Rows, settings.ApiToken, settings.ApiUrl, settings.WebUrl);

    public async Task SendCycleAsync(PilotSettings settings, CancellationToken ct)
    {
        // Cycles keep their state in the API. Clearing first prevents mid-cycle auto-compaction and keeps
        // untrusted page content from lingering into the next cycle.
        await SendAsync(ClearCommand, settings.Provider, ct);
        await Task.Delay(ClearSettle, ct);

        while (signals.Reader.TryRead(out _))
        {
        }

        stuck.Reset();
        await SendAsync(settings.Provider.SkillCommand(PilotSkill), settings.Provider, ct);
    }

    public Task SendDirectiveAsync(PilotSettings settings, Directive directive, CancellationToken ct)
    {
        // A directive keeps the stuck cycle's context: no /clear, and a sentinel that raced in must survive.
        stuck.Reset();
        DropStuckSignals();
        return SendAsync(directive == Directive.CheckIn ? CheckInText : SkipText, settings.Provider, ct);
    }

    public async Task<WaitResult> WaitForSignalAsync(TimeSpan timeout, CancellationToken ct)
    {
        using var waitCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var exited = false;

        void OnExited(SessionExit _)
        {
            exited = true;
            waitCts.Cancel();
        }

        // Subscribe before checking IsRunning: an exit between the two would otherwise go unseen for the whole timeout.
        terminal.Exited += OnExited;
        try
        {
            if (!terminal.IsRunning)
            {
                return WaitResult.Exited;
            }

            waitCts.CancelAfter(timeout);
            var signal = await signals.Reader.ReadAsync(waitCts.Token);
            return signal is { } cycle ? WaitResult.Sentinel(cycle) : WaitResult.Stuck;
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return exited ? WaitResult.Exited : WaitResult.Timeout;
        }
        finally
        {
            terminal.Exited -= OnExited;
        }
    }

    public void Stop() => terminal.Stop();

    // Esc interrupts both provider TUIs and is harmless at an idle prompt.
    public void Interrupt()
    {
        if (terminal.IsRunning)
        {
            terminal.Write([0x1b]);
        }
    }

    public Task DelayAsync(TimeSpan duration, CancellationToken ct) => Task.Delay(duration, ct);

    public async Task<PilotActivity?> GetActivityAsync(CancellationToken ct) =>
        store.Current is { } settings ? await api.GetActivityAsync(settings, ct) : null;

    public async Task ReportAsync(string summary, CancellationToken ct)
    {
        if (store.Current is { } settings)
        {
            await api.ReportAsync(settings, summary, ct);
        }
    }

    public void Dispose() => terminal.Output -= OnOutput;

    private async Task SendAsync(string command, Provider provider, CancellationToken ct)
    {
        var result = await terminal.SendCommandAsync(command, provider, ct);
        if (result != SendResult.Sent)
        {
            logger.LogWarning("Pilot command {Command} was not sent ({Result}).", command, result);
        }
    }

    private void OnOutput(byte[] data)
    {
        // Interactive sessions skip the parsers. Nothing is lost: start saves the store before the first cycle.
        if (store.Current is not { Running: true })
        {
            return;
        }

        var cycles = sentinels.Feed(data);
        foreach (var cycle in cycles)
        {
            signals.Writer.TryWrite(cycle);
        }

        // A finished cycle clears stuck evidence before the next one gathers its own.
        if (cycles.Count > 0)
        {
            stuck.Reset();
            return;
        }

        if (stuck.Feed(data, DateTimeOffset.UtcNow) is var reason and not StuckReason.None)
        {
            logger.LogDebug("Pilot stuck heuristic fired ({Reason}).", reason);
            signals.Writer.TryWrite(null);
        }
    }

    // Stuck evidence left over from before a directive would end its grace at once, but a sentinel must survive.
    private void DropStuckSignals()
    {
        List<CycleResult> kept = [];
        while (signals.Reader.TryRead(out var signal))
        {
            if (signal is { } cycle)
            {
                kept.Add(cycle);
            }
        }

        foreach (var cycle in kept)
        {
            signals.Writer.TryWrite(cycle);
        }
    }
}
