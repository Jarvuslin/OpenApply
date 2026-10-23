using OpenApply.Terminal.Agent;
using OpenApply.Terminal.Queue;
using OpenApply.Terminal.Questions;

namespace OpenApply.Terminal.Preparation;

public static class PreparationEndpoints
{
    internal static bool IsHash(string? value) => value is { Length: 64 } && value.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f');

    public static void MapPreparationEndpoints(this WebApplication app) => app.MapPost("/preparation/fill", async (PreparationRequest request, PreparationRuntime runtime, CancellationToken ct) =>
    {
        if (string.IsNullOrWhiteSpace(request.ApiToken) || request.ApiToken.Length > 16000 || !QueueEndpoints.IsServiceUrl(request.ApiUrl) || !Guid.TryParse(request.JobId, out _) || !Guid.TryParse(request.RequestId, out _) || request.ExpectedCollectionVersion < 1 || !IsHash(request.ManifestHash))
            return Results.Problem("Provide current authenticated job preparation details.", statusCode: 400);
        try { return Results.Ok(await runtime.FillAsync(request, ct)); }
        catch (ArgumentException ex) { return Results.Problem(ex.Message, statusCode: 400); }
        catch (InvalidOperationException ex) { return Results.Problem(ex.Message, statusCode: 409); }
        catch (QuestionBrowserCleanupException ex) { return Results.Problem(ex.Message, statusCode: 502); }
        catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.Conflict) { return Results.Problem("Preparation changed. Refresh and review the current manifest.", statusCode: 409); }
        catch (Exception ex) when (ex is HttpRequestException or InvalidDataException or OperationCanceledException or System.ComponentModel.Win32Exception or System.Text.Json.JsonException)
        { return Results.Problem("Preparation could not be checked. Review sign-in, current facts and document selection, then retry explicitly.", statusCode: 502); }
    });
}
