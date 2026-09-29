using JobPilot.Terminal.Hosting;
using JobPilot.Terminal.Providers;
using Microsoft.AspNetCore.Http.HttpResults;

namespace JobPilot.Terminal.Pilot;

public sealed record PilotStartRequest(string? Provider, string? ApiToken, string? ApiUrl, string? WebUrl);

/// <summary>The pilot part of /healthz.</summary>
public sealed record PilotStatus
{
    public required bool Running { get; init; }

    /// <summary>Whether pilot settings are saved.</summary>
    public required bool Paired { get; init; }

    /// <summary>Whether the loop is driving a session right now.</summary>
    public required bool Conducting { get; init; }

    public DateTimeOffset? LastCycleAt { get; init; }

    /// <summary><c>ok</c>, <c>empty</c>, or <c>error</c>.</summary>
    public string? LastCycleStatus { get; init; }

    /// <summary>Restarts of a stuck session in a row; reset by a finished cycle.</summary>
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
            // Keeps the settings and the session; the loop interrupts the agent's turn and stops starting cycles.
            store.SetRunning(false);
            return TypedResults.Ok(status.Get());
        });
    }

    internal static bool IsHttpUrl(string? value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);
}
