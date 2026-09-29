using JobPilot.Terminal.Sessions;
using Microsoft.AspNetCore.Http.HttpResults;

namespace JobPilot.Terminal.Hosting;

/// <summary>Acknowledges /shutdown; the process exits shortly after this response flushes.</summary>
public sealed record ShutdownResult(bool Ok);

public static class HostEndpoints
{
    public static void MapHostEndpoints(this WebApplication app)
    {
        app.MapGet("/healthz", (HostStatus status) => TypedResults.Ok(status.Get()));

        app.MapPost("/shutdown", (TerminalSession session, IHostApplicationLifetime lifetime) =>
        {
            // pilot.json keeps Running as-is, so the next start resumes the pilot.
            session.Stop();
            lifetime.StopAfterResponse();
            return TypedResults.Ok(new ShutdownResult(Ok: true));
        });
    }
}

internal static class Problems
{
    public static ProblemHttpResult BadRequest(string detail) =>
        TypedResults.Problem(title: "Invalid request", detail: detail, statusCode: StatusCodes.Status400BadRequest);
}

internal static class LifetimeExtensions
{
    // Long enough for Kestrel to flush the caller's 200 before teardown starts.
    private static readonly TimeSpan ResponseFlush = TimeSpan.FromMilliseconds(500);

    /// <summary>Stops the host once the caller's response has flushed. Ignores cancellation, so the port is always released.</summary>
    public static void StopAfterResponse(this IHostApplicationLifetime lifetime) =>
        _ = Task.Run(async () =>
        {
            await Task.Delay(ResponseFlush, CancellationToken.None);
            lifetime.StopApplication();
        }, CancellationToken.None);
}
