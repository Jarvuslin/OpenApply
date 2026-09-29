using JobPilot.Terminal.Pilot;
using JobPilot.Terminal.Providers;
using JobPilot.Terminal.Sessions;

namespace JobPilot.Terminal.Hosting;

/// <summary>What /healthz and every control endpoint return.</summary>
public sealed record StatusResponse
{
    public const string StatusOk = "ok";

    /// <summary>The host runs but cannot start sessions, e.g. the plugin tree is missing.</summary>
    public const string StatusDegraded = "degraded";

    public const string SessionRunning = "running";
    public const string SessionStopped = "stopped";

    public required string Status { get; init; }

    public required string Session { get; init; }

    /// <summary>The running or last started provider.</summary>
    public required string Provider { get; init; }

    public required ProviderInfo[] Providers { get; init; }

    public required string HostVersion { get; init; }

    /// <summary>Why the host is degraded.</summary>
    public string? Detail { get; init; }

    /// <summary>Whether the browser can relaunch the host through the jobpilot:// scheme.</summary>
    public bool CanRelaunch { get; init; }

    public bool CanUpdate { get; init; }

    public required PilotStatus Pilot { get; init; }
}

public sealed class HostStatus(TerminalSession session, HostInstall install, UrlScheme scheme, PilotLoop pilot)
{
    // Long enough for Kestrel to flush the caller's 200 before teardown starts.
    private static readonly TimeSpan ResponseFlush = TimeSpan.FromMilliseconds(500);

    public StatusResponse Get() => new()
    {
        Status = install.PathsError is null ? StatusResponse.StatusOk : StatusResponse.StatusDegraded,
        Session = session.IsRunning ? StatusResponse.SessionRunning : StatusResponse.SessionStopped,
        Provider = session.ActiveProvider,
        Providers = Provider.All,
        HostVersion = HostInstall.HostVersion,
        Detail = install.PathsError,
        CanRelaunch = scheme.IsRegistered,
        CanUpdate = install.CanUpdate,
        Pilot = pilot.GetStatus(),
    };

    /// <summary>Stops the host once the caller's response has flushed. Ignores cancellation, so the port is always released.</summary>
    public static void StopAfterResponse(IHostApplicationLifetime lifetime) =>
        _ = Task.Run(async () =>
        {
            await Task.Delay(ResponseFlush, CancellationToken.None);
            lifetime.StopApplication();
        }, CancellationToken.None);
}
