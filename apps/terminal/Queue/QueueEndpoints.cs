using OpenApply.Terminal.Agent;

namespace OpenApply.Terminal.Queue;

public static class QueueEndpoints
{
    public static void MapQueueEndpoints(this WebApplication app)
    {
        app.MapGet("/queue/status", (QueueRuntime runtime) => Results.Ok(runtime.Status));
        app.MapGet("/queue/account-setup/readiness", AccountSetupPreflight.Readiness);
        app.MapPost("/queue/account-setup/launch", async (AccountLaunchRequest input, HttpContext context, QueueRuntime runtime, CancellationToken ct) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            var auth = context.Request.Headers.Authorization.ToString();
            if (!auth.StartsWith("Bearer ", StringComparison.Ordinal) || auth.Length <= 7) return Results.Unauthorized();
            try { return Results.Json(await runtime.LaunchAccountAsync(input, auth[7..], ct), AppJsonContext.Default.QueueStatus); }
            catch (Exception ex) when (ex is InvalidOperationException or ArgumentException or FormatException or HttpRequestException or IOException or System.Text.Json.JsonException or OperationCanceledException)
            { return Results.Problem("Account launch could not be confirmed. Refresh the saved item and local queue before another explicit launch; no automatic retry was scheduled.", statusCode: 409); }
        });
        app.MapGet("/queue/accounts/{workItemId}/handoff", async (string workItemId, HttpContext context, QueueRuntime runtime, CancellationToken ct) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            var auth = context.Request.Headers.Authorization.ToString();
            if (!Guid.TryParseExact(workItemId, "D", out _)) return Results.NotFound();
            if (!auth.StartsWith("Bearer ", StringComparison.Ordinal) || auth.Length <= 7) return Results.Unauthorized();
            try { return Results.Json(await runtime.AccountHandoffAsync(workItemId, auth[7..], ct), AppJsonContext.Default.AccountHandoffStatus); }
            catch (Exception ex) when (ex is InvalidOperationException or HttpRequestException or IOException or System.Text.Json.JsonException or OperationCanceledException)
            { return Results.Problem("This account handoff is unavailable. Its browser was not reopened.", statusCode: 409); }
        });
        app.MapPost("/queue/workers/{browserSessionId}/account", async (string browserSessionId, AccountControlRequest input, HttpRequest request, QueueRuntime runtime, CancellationToken ct) =>
        {
            if (!Guid.TryParseExact(browserSessionId, "D", out _)) return Results.NotFound();
            try { return Results.Json(await runtime.AccountControlAsync(browserSessionId, request.Headers["X-OpenApply-Worker-Capability"].ToString(), input, ct), AppJsonContext.Default.JsonObject); }
            catch (Exception ex) when (ex is InvalidOperationException or ArgumentException or HttpRequestException or IOException or System.Text.Json.JsonException or OperationCanceledException)
            { return Results.Problem("The scoped account operation stopped. Inspect saved account state before continuing.", statusCode: 409); }
        });
        app.MapGet("/queue/workers/{browserSessionId}/frame", async (string browserSessionId, string workItemId, string executionId, HttpContext context, QueueRuntime runtime, CancellationToken ct) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            if (!Guid.TryParseExact(browserSessionId, "D", out _) || !Guid.TryParseExact(workItemId, "D", out _) || !Guid.TryParseExact(executionId, "D", out _)) return Results.NotFound();
            var authorization = context.Request.Headers.Authorization.ToString();
            if (!authorization.StartsWith("Bearer ", StringComparison.Ordinal) || authorization.Length <= 7) return Results.Unauthorized();
            try { return Results.Json(await runtime.FrameAsync(browserSessionId, workItemId, executionId, authorization[7..], ct), AppJsonContext.Default.QueueFrame); }
            catch (Exception ex) when (ex is InvalidOperationException or ArgumentException or HttpRequestException or IOException or InvalidDataException or OperationCanceledException or System.Text.Json.JsonException)
            { return Results.Problem("This authenticated browser view is unavailable. Worker execution was not changed.", statusCode: 409); }
        });
        app.MapPost("/queue/workers/{browserSessionId}/{action}", async (string browserSessionId, string action, HttpRequest request, QueueRuntime runtime, CancellationToken ct) =>
        {
            if (!Guid.TryParseExact(browserSessionId, "D", out _) || action is not ("attach" or "prepare" or "handoff" or "inspect" or "login")) return Results.NotFound();
            try { return Results.Json(await runtime.ControlAsync(browserSessionId, request.Headers["X-OpenApply-Worker-Capability"].ToString(), action, ct), AppJsonContext.Default.JsonObject); }
            catch (Exception ex) when (ex is InvalidOperationException or ArgumentException or HttpRequestException or IOException or InvalidDataException or OperationCanceledException)
            { return Results.Problem("Owned browser control refused or stopped. Review this work item before continuing.", statusCode: 409); }
        });
        app.MapPost("/queue/connect", async (ConnectRequest request, QueueRuntime runtime, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.ApiToken) || request.ApiToken.Length > 16000
                || !QueueEndpoints.IsServiceUrl(request.ApiUrl) || !QueueEndpoints.IsServiceUrl(request.WebUrl))
                return Results.Problem("Provide an API token and absolute HTTPS service URLs (HTTP is allowed on loopback).", statusCode: 400);
            try { await runtime.ConnectAsync(request, ct); return Results.Ok(runtime.Status); }
            catch (InvalidOperationException ex) { return Results.Problem(ex.Message, statusCode: 409); }
            catch (Exception ex) when (ex is HttpRequestException or OperationCanceledException or IOException or InvalidDataException or System.Text.Json.JsonException)
            { return Results.Problem("Could not authenticate the queue connection. Sign in and retry.", statusCode: 502); }
        });
        app.MapDelete("/queue/connection", async (HttpRequest request, QueueRuntime runtime, CancellationToken ct) =>
            await TryDisconnectAsync(request, runtime, ct) ?? Results.Ok(runtime.Status));
    }

    internal static bool IsServiceUrl(string? value) => Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && string.IsNullOrEmpty(uri.UserInfo) && string.IsNullOrEmpty(uri.Query) && string.IsNullOrEmpty(uri.Fragment)
        && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp && uri.IsLoopback);

    internal static async Task<IResult?> TryDisconnectAsync(HttpRequest request, QueueRuntime runtime, CancellationToken ct)
    {
        var authorization = request.Headers.Authorization.ToString();
        if (!authorization.StartsWith("Bearer ", StringComparison.Ordinal) || authorization.Length <= 7) return Results.Unauthorized();
        var owner = request.Query["expectedOwnerId"].ToString();
        var generation = request.Query["connectionId"].ToString();
        if (!Guid.TryParseExact(owner, "D", out _) || !Guid.TryParseExact(generation, "D", out _))
            return Results.Problem("The current account and connection identity are required.", statusCode: 400);
        try { await runtime.DisconnectAuthenticatedAsync(owner, generation, authorization[7..], ct); return null; }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException or HttpRequestException or IOException or InvalidDataException or OperationCanceledException or System.Text.Json.JsonException)
        { return Results.Problem("This account or connection could not be verified. No worker was stopped.", statusCode: 409); }
    }
}
