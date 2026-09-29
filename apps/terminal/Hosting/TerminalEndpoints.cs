using JobPilot.Terminal.Providers;
using JobPilot.Terminal.Contracts;
using JobPilot.Terminal.Hosting;
using JobPilot.Terminal.Pilot;
using JobPilot.Terminal.Sessions;
using JobPilot.Terminal.Updates;
using Microsoft.AspNetCore.Http.HttpResults;

namespace JobPilot.Terminal.Hosting;

/// <summary>Maps the terminal host API.</summary>
public static class TerminalEndpoints
{
    private const int MaxCommandLength = 32 * 1024;

    /// <summary>Maps health, session, update, and WebSocket endpoints.</summary>
    public static WebApplication MapTerminalEndpoints(this WebApplication app)
    {
        app.MapGet("/healthz", (TerminalSession session, HostInstall install, ProtocolRegistrar registrar, PilotCoordinator pilot) => TypedResults.Ok(CurrentStatus(session, install, registrar, pilot)));

        app.MapPost("/sessions/start", Results<Ok<SessionStatus>, ProblemHttpResult> (StartSessionRequest request, TerminalSession session, HostInstall install, ProtocolRegistrar registrar, PilotCoordinator pilot) =>
        {
            if (!Viewport.IsValid(request.Cols, request.Rows))
            {
                return BadRequest($"cols and rows must each be between {Viewport.MinSize} and {Viewport.MaxSize}.");
            }

            try
            {
                session.Start(request.Provider, request.Cols, request.Rows, request.ApiToken, request.ApiUrl, request.WebUrl);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (Exception ex)
            {
                return TypedResults.Problem(
                    title: "Failed to start terminal session",
                    detail: ex.Message,
                    statusCode: StatusCodes.Status500InternalServerError);
            }
            return TypedResults.Ok(CurrentStatus(session, install, registrar, pilot));
        });

        app.MapPost("/sessions/inject", async Task<Results<Ok, ProblemHttpResult>> (
            InjectRequest request, TerminalSession session, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.Command))
            {
                return BadRequest("command must be a non-empty string.");
            }

            if (request.Command.Length > MaxCommandLength)
            {
                return BadRequest($"command must be at most {MaxCommandLength} characters.");
            }

            SendResult result;
            try
            {
                result = await session.SendCommandAsync(request.Command, request.Provider, ct);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }

            return result switch
            {
                SendResult.Sent => TypedResults.Ok(),
                SendResult.ProviderMismatch => Conflict("The active provider does not match the requested provider."),
                _ => Conflict("The terminal session is not running."),
            };
        });

        app.MapDelete("/sessions/current", (TerminalSession session, HostInstall install, ProtocolRegistrar registrar, PilotCoordinator pilot) =>
        {
            session.Stop();
            return TypedResults.Ok(CurrentStatus(session, install, registrar, pilot));
        });

        app.MapPost("/pilot/start", Results<Ok<SessionStatus>, ProblemHttpResult> (
            PilotStartRequest request, PilotStore store, PilotCoordinator pilot, TerminalSession session, HostInstall install, ProtocolRegistrar registrar) =>
        {
            string provider;
            try
            {
                provider = Provider.Find(request.Provider).Id;
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }

            if (string.IsNullOrWhiteSpace(request.ApiToken))
            {
                return BadRequest("apiToken must be a non-empty string.");
            }

            if (!IsHttpUrl(request.ApiUrl))
            {
                return BadRequest("apiUrl must be an absolute HTTP(S) URL.");
            }

            if (!IsHttpUrl(request.WebUrl))
            {
                return BadRequest("webUrl must be an absolute HTTP(S) URL.");
            }

            store.Save(new PilotPairing
            {
                Provider = provider,
                ApiToken = request.ApiToken,
                ApiUrl = request.ApiUrl!,
                WebUrl = request.WebUrl!,
                Running = true,
            });
            pilot.WakeUp();
            return TypedResults.Ok(CurrentStatus(session, install, registrar, pilot));
        });

        app.MapPost("/pilot/stop", (PilotStore store, PilotCoordinator pilot, TerminalSession session, HostInstall install, ProtocolRegistrar registrar) =>
        {
            // Keep the pairing and the session; the coordinator interrupts a mid-cycle turn and stops driving.
            store.SetRunning(false);
            pilot.WakeUp();
            return TypedResults.Ok(CurrentStatus(session, install, registrar, pilot));
        });

        app.MapPost("/update", async Task<Results<Ok<UpdateResult>, ProblemHttpResult>> (
            HostUpdateService updates, IHostApplicationLifetime lifetime, CancellationToken ct) =>
        {
            try
            {
                var result = await updates.UpdateNowAsync(ct);
                if (result.Updating)
                {
                    HostHandoff.BeginRelease(lifetime);
                }
                return TypedResults.Ok(result);
            }
            catch (Exception ex)
            {
                return TypedResults.Problem(
                    title: "Failed to update the terminal host",
                    detail: ex.Message,
                    statusCode: StatusCodes.Status500InternalServerError);
            }
        });

        app.MapPost("/shutdown", (TerminalSession session, IHostApplicationLifetime lifetime) =>
        {
            // Stop the PTY now; StopApplication then cancels the Pilot coordinator. pilot.json's Running flag is
            // deliberately left as-is so a later start resumes the pilot via ResumeIfRunningAsync.
            session.Stop();
            GracefulStop.Schedule(lifetime);
            return TypedResults.Ok(new ShutdownResult { Ok = true });
        });

        app.MapGet("/ws", async (HttpContext ctx, TerminalRelay relay) =>
        {
            if (!ctx.WebSockets.IsWebSocketRequest)
            {
                ctx.Response.StatusCode = StatusCodes.Status400BadRequest;
                return;
            }

            using var socket = await ctx.WebSockets.AcceptWebSocketAsync();
            await relay.ServeAsync(socket, ctx.RequestAborted);
        });

        return app;
    }

    private static ProblemHttpResult BadRequest(string detail) => TypedResults.Problem(
        title: "Invalid request", detail: detail, statusCode: StatusCodes.Status400BadRequest);

    private static ProblemHttpResult Conflict(string detail) => TypedResults.Problem(
        title: "Inject rejected", detail: detail, statusCode: StatusCodes.Status409Conflict);

    internal static bool IsHttpUrl(string? value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);

    private static SessionStatus CurrentStatus(TerminalSession session, HostInstall install, ProtocolRegistrar registrar, PilotCoordinator pilot) => new()
    {
        Status = install.PathsError is null ? SessionStatus.StatusOk : SessionStatus.StatusDegraded,
        Session = session.IsRunning ? SessionStatus.SessionRunning : SessionStatus.SessionStopped,
        Provider = session.ActiveProvider,
        Providers = Provider.All,
        HostVersion = HostInstall.HostVersion,
        Detail = install.PathsError,
        CanRelaunch = registrar.IsRegistered,
        CanUpdate = install.CanUpdate,
        Pilot = pilot.BuildStatus(),
    };
}
