using OpenApply.Terminal.Hosting;
using OpenApply.Terminal.Agent;
using OpenApply.Terminal.Providers;
using Microsoft.AspNetCore.Http.HttpResults;

namespace OpenApply.Terminal.Pilot;

public sealed record PilotStartRequest(string? Provider, string? ApiToken, string? ApiUrl, string? WebUrl);

/// <summary>The pilot part of /healthz.</summary>
public sealed record PilotStatus
{
    public string Mode { get; init; } = "queue_scheduler";

    public required bool Running { get; init; }

    /// <summary>Whether pilot settings are saved.</summary>
    public required bool Paired { get; init; }

    /// <summary>Always false: Pilot schedules work and never drives a provider session.</summary>
    public required bool Conducting { get; init; }

    public DateTimeOffset? LastCycleAt { get; init; }

    /// <summary><c>ok</c>, <c>empty</c>, or <c>error</c>.</summary>
    public string? LastCycleStatus { get; init; }

    /// <summary>Always zero: the scheduler never restarts an agent.</summary>
    public required int ConsecutiveTimeouts { get; init; }
}

public static class PilotEndpoints
{
    public static void MapPilotEndpoints(this WebApplication app)
    {
        app.MapPost("/pilot/start", Results<Ok<StatusResponse>, ProblemHttpResult> (
            PilotStartRequest request, PilotStore store, HostStatus status) =>
        {
            var provider = Provider.Find(request.Provider);
            if (string.IsNullOrWhiteSpace(request.ApiToken))
            {
                return Problems.BadRequest("apiToken must be a non-empty string.");
            }

            if (!IsHttpUrl(request.ApiUrl))
            {
                return Problems.BadRequest("apiUrl must be an absolute HTTP(S) URL.");
            }

            if (!IsHttpUrl(request.WebUrl))
            {
                return Problems.BadRequest("webUrl must be an absolute HTTP(S) URL.");
            }

            store.Save(new PilotSettings
            {
                Provider = provider,
                ApiToken = request.ApiToken,
                ApiUrl = request.ApiUrl!,
                WebUrl = request.WebUrl!,
                Running = true,
            });
            return TypedResults.Ok(status.Get());
        });

        app.MapPost("/pilot/stop", (PilotStore store, HostStatus status) =>
        {
            // Stop future admission; already queued work remains visible for explicit pause or cancellation.
            store.SetRunning(false);
            return TypedResults.Ok(status.Get());
        });
    }

    internal static bool IsHttpUrl(string? value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);
}
