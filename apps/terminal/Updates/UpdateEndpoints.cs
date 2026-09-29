using JobPilot.Terminal.Hosting;
using Microsoft.AspNetCore.Http.HttpResults;

namespace JobPilot.Terminal.Updates;

public sealed record UpdateResult
{
    public const string ReasonUpToDate = "up-to-date";
    public const string ReasonDevCheckout = "dev-checkout";
    public const string ReasonInProgress = "in-progress";
    public const string ReasonNoAsset = "no-asset";

    /// <summary>Whether a newer release was installed and launched.</summary>
    public required bool Updating { get; init; }

    public required string FromVersion { get; init; }

    public string? ToVersion { get; init; }

    /// <summary>Why no update happened.</summary>
    public string? Reason { get; init; }
}

public static class UpdateEndpoints
{
    public static void MapUpdateEndpoints(this WebApplication app)
    {
        app.MapPost("/update", async Task<Results<Ok<UpdateResult>, ProblemHttpResult>> (
            HostUpdater updates, IHostApplicationLifetime lifetime, CancellationToken ct) =>
        {
            try
            {
                var result = await updates.UpdateNowAsync(ct);
                if (result.Updating)
                {
                    // The replacement waits for this process to release the port.
                    HostStatus.StopAfterResponse(lifetime);
                }

                return TypedResults.Ok(result);
            }
            catch (Exception ex)
            {
                return Problems.ServerError("Failed to update the terminal host", ex.Message);
            }
        });
    }
}
