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
            HostStatus.StopAfterResponse(lifetime);
            return TypedResults.Ok(new ShutdownResult(Ok: true));
        });
    }
}

internal static class Problems
{
    public static ProblemHttpResult BadRequest(string detail) =>
        TypedResults.Problem(title: "Invalid request", detail: detail, statusCode: StatusCodes.Status400BadRequest);

    public static ProblemHttpResult ServerError(string title, string detail) =>
        TypedResults.Problem(title: title, detail: detail, statusCode: StatusCodes.Status500InternalServerError);
}
