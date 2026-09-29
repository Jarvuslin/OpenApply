namespace JobPilot.Terminal.Contracts;

/// <summary>Request to start a terminal session.</summary>
public sealed record StartSessionRequest
{
    /// <summary>Initial terminal column count.</summary>
    public int Cols { get; init; }

    /// <summary>Initial terminal row count.</summary>
    public int Rows { get; init; }

    /// <summary>Optional terminal provider id. Defaults to Claude.</summary>
    public string? Provider { get; init; }

    /// <summary>Optional per-user agent PAT, injected into the PTY as JOBPILOT_API_TOKEN.</summary>
    public string? ApiToken { get; init; }

    /// <summary>Web origin injected as JOBPILOT_WEB.</summary>
    public string? WebUrl { get; init; }

    /// <summary>API base URL injected as JOBPILOT_API.</summary>
    public string? ApiUrl { get; init; }
}

/// <summary>Request to inject a command into the active session.</summary>
/// <param name="Command">Command text to write.</param>
/// <param name="Provider">Optional provider id for the intended session.</param>
public sealed record InjectRequest(string? Command, string? Provider = null);

/// <summary>Request to start pilot mode with a provider pairing.</summary>
public sealed record PilotStartRequest
{
    /// <summary>Provider that drives the pilot loop. Defaults to Claude.</summary>
    public string? Provider { get; init; }

    /// <summary>Per-user agent PAT, injected into the PTY as JOBPILOT_API_TOKEN.</summary>
    public string? ApiToken { get; init; }

    /// <summary>API base URL injected as JOBPILOT_API.</summary>
    public string? ApiUrl { get; init; }

    /// <summary>Web origin injected as JOBPILOT_WEB.</summary>
    public string? WebUrl { get; init; }
}
