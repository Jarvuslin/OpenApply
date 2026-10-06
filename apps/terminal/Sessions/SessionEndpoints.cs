using OpenApply.Terminal.Hosting;
using OpenApply.Terminal.Providers;
using Microsoft.AspNetCore.Http.HttpResults;

namespace OpenApply.Terminal.Sessions;

public sealed record StartSessionRequest(int Cols, int Rows, string? Provider, string? ApiToken, string? ApiUrl, string? WebUrl);

public sealed record InjectRequest(string? Command, string? Provider = null);

public static class Viewport
{
    public const int MinSize = 1;
    public const int MaxSize = 2000;

    public static bool IsValid(int cols, int rows) =>
        cols is >= MinSize and <= MaxSize && rows is >= MinSize and <= MaxSize;
}

public static class SessionEndpoints
{
    private const int MaxCommandLength = 32 * 1024;

    public static void MapSessionEndpoints(this WebApplication app)
    {
        app.MapPost("/sessions/start", Results<Ok<StatusResponse>, ProblemHttpResult> (
            StartSessionRequest request, TerminalSession session, HostStatus status) =>
        {
            if (!Viewport.IsValid(request.Cols, request.Rows))
            {
                return Problems.BadRequest($"cols and rows must each be between {Viewport.MinSize} and {Viewport.MaxSize}.");
            }

            session.Start(Provider.Find(request.Provider), request.Cols, request.Rows, request.ApiToken, request.ApiUrl, request.WebUrl);
            return TypedResults.Ok(status.Get());
        });

        app.MapPost("/sessions/inject", async Task<Results<Ok, ProblemHttpResult>> (
            InjectRequest request, TerminalSession session, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.Command))
            {
                return Problems.BadRequest("command must be a non-empty string.");
            }

            if (request.Command.Length > MaxCommandLength)
            {
                return Problems.BadRequest($"command must be at most {MaxCommandLength} characters.");
            }

            // No provider means any: Find would read a blank id as Claude.
            var expected = request.Provider is null ? null : Provider.Find(request.Provider);
            var result = await session.SendCommandAsync(request.Command, expected, ct);
            return result switch
            {
                SendResult.Sent => TypedResults.Ok(),
                SendResult.ProviderMismatch => Rejected("The active provider does not match the requested provider."),
                _ => Rejected("The terminal session is not running."),
            };
        });

        app.MapDelete("/sessions/current", (TerminalSession session, HostStatus status) =>
        {
            session.Stop();
            return TypedResults.Ok(status.Get());
        });

        app.MapGet("/ws", async (HttpContext context, TerminalRelay relay) =>
        {
            if (!context.WebSockets.IsWebSocketRequest)
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                return;
            }

            using var socket = await context.WebSockets.AcceptWebSocketAsync();
            await relay.ServeAsync(socket, context.RequestAborted);
        });
    }

    private static ProblemHttpResult Rejected(string detail) =>
        TypedResults.Problem(title: "Inject rejected", detail: detail, statusCode: StatusCodes.Status409Conflict);
}
