using System.Text.Json;
using OpenApply.Terminal.Hosting;
using OpenApply.Terminal.Inference;
using OpenApply.Terminal.Providers;

namespace OpenApply.Terminal.Connectors;

public static class GmailCheckEndpoints
{
    private static readonly InferenceRunner Runner = new();

    public static void MapGmailCheckEndpoints(this WebApplication app)
    {
        app.MapPost("/connectors/gmail/check", async (GmailCheckRequest request, HostInstall install, ILoggerFactory loggerFactory, CancellationToken ct) =>
        {
            var provider = Provider.Find(request.Provider);
            var expected = GmailCheckProtocol.NormalizeEmail(request.ExpectedEmail);
            if (!string.IsNullOrWhiteSpace(request.ExpectedEmail) && expected is null)
                return Results.Problem("Enter a valid expected Gmail address.", statusCode: 400);
            if (provider.Id != "claude")
                return Results.Ok(new GmailCheckResponse(provider.Id, "needs_user", null,
                    "Background Gmail checks currently support Claude Code. Choose Claude for this check; Codex remains available for other agent tasks.", "switch_provider"));
            var executable = ExecutablePath.Find(provider.Command);
            if (executable is null || ExecutablePath.NeedsShell(executable))
                return Results.Ok(new GmailCheckResponse(provider.Id, "needs_user", null,
                    "Install the native Claude Code CLI and sign in with your Claude subscription, then check again.", "sign_in"));
            try
            {
                var result = await Runner.RunAsync(
                    token => CheckAsync(executable, install.RequirePaths().ScratchDir, expected, loggerFactory.CreateLogger("GmailCheck"), token),
                    TimeSpan.FromSeconds(90), ct);
                return result is null
                    ? Results.Problem("Another Gmail check is running. Cancel it or wait, then retry.", statusCode: 409)
                    : Results.Ok(result);
            }
            catch (OperationCanceledException)
            {
                return Results.Problem("The Gmail check timed out or was cancelled. No messages were imported or changed.", statusCode: 504);
            }
            catch (Exception ex) when (ex is InvalidOperationException or IOException or JsonException or UnauthorizedAccessException or System.ComponentModel.Win32Exception)
            {
                return Results.Ok(new GmailCheckResponse("claude", "error", null,
                    "The companion could not complete the Gmail check. Confirm Claude Code is up to date and signed in, then retry.", "retry"));
            }
        });
    }

    private static async Task<GmailCheckResponse> CheckAsync(string executable, string scratch, string? expected, ILogger logger, CancellationToken ct)
    {
        var cwd = Path.Combine(scratch, "gmail-check", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(cwd);
        var statePath = Path.Combine(cwd, "evidence.json");
        var settingsPath = Path.Combine(cwd, "settings.json");
        var stage = "cli_version";
        try
        {
            var versionText = await InferenceRunner.RunProcessAsync(GmailCheckProtocol.Process(executable, cwd, ["--version"]), "", ct);
            var versionToken = versionText.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
            if (!Version.TryParse(versionToken, out var version) || version < new Version(2, 1, 291))
                return new("claude", "needs_user", null, "Update Claude Code to version 2.1.291 or newer for the restricted background Gmail check.", "retry");

            stage = "hook_preflight";
            await File.WriteAllTextAsync(statePath, JsonSerializer.Serialize(new GmailCheckEvidence { ExpectedEmail = expected }, AppJsonContext.Default.GmailCheckEvidence), ct);
            var (command, prefix) = GmailCheckProtocol.HookExecutable();
            await File.WriteAllTextAsync(settingsPath, GmailCheckProtocol.Settings(command, prefix, statePath), ct);
            // A broken hook executable must fail before a model can access any connector.
            var probe = GmailCheckProtocol.Process(command, cwd, [.. prefix, GmailToolGate.Flag, statePath, "pre"]);
            var denied = await InferenceRunner.RunProcessAsync(probe, "{\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Bash\",\"tool_input\":{}}", ct);
            using (var proof = JsonDocument.Parse(denied))
            {
                if (proof.RootElement.GetProperty("hookSpecificOutput").GetProperty("permissionDecision").GetString() != "deny")
                    throw new InvalidOperationException("The read-only gate did not start.");
            }
            await File.WriteAllTextAsync(statePath, JsonSerializer.Serialize(new GmailCheckEvidence { ExpectedEmail = expected }, AppJsonContext.Default.GmailCheckEvidence), ct);
            stage = "cli_check";
            var start = GmailCheckProtocol.Process(executable, cwd, GmailCheckProtocol.Arguments(settingsPath));
            var output = await InferenceRunner.RunProcessAsync(start, GmailCheckProtocol.Prompt(expected), ct);
            if (output.Length > 1024 * 1024) throw new JsonException("Check output exceeded its limit.");
            stage = "result_validation";
            var evidence = JsonSerializer.Deserialize(await File.ReadAllTextAsync(statePath, ct), AppJsonContext.Default.GmailCheckEvidence)
                ?? throw new JsonException("Missing Gmail-check evidence.");
            var result = GmailCheckProtocol.Result(output, evidence);
            logger.LogInformation("Gmail check {Status}: reason={Reason}, hooks={HookCalls}, profileAttempted={ProfileAttempted}, profile={ProfileResult}, searchAttempted={SearchAttempted}, search={SearchResult}, gmailDiscovered={GmailDiscovered}, profileToolDiscovered={ProfileToolDiscovered}, blockedTools={BlockedTools}",
                result.Status, SafeReason(output), evidence.HookCalls, evidence.ProfileCall is not null, evidence.ProfileResult,
                evidence.SearchCall is not null, evidence.SearchResult, evidence.GmailToolsDiscovered, evidence.ProfileToolDiscovered, string.Join(',', evidence.BlockedGmailTools));
            return result;
        }
        catch (Exception ex)
        {
            logger.LogWarning("Gmail check failed at {Stage} ({ErrorType}).", stage, ex.GetType().Name);
            throw;
        }
        finally
        {
            // These are the only files this task writes; never retain mailbox evidence or model transcripts.
            foreach (var path in new[] { statePath, settingsPath })
            {
                try { File.Delete(path); }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
            }
        }
    }

    internal static string SafeReason(string output)
    {
        using var document = JsonDocument.Parse(output);
        if (document.RootElement.TryGetProperty("structured_output", out var result) && result.ValueKind == JsonValueKind.Object
            && result.TryGetProperty("reason", out var reason) && reason.ValueKind == JsonValueKind.String)
            return reason.GetString() switch
            {
                "ready" => "ready",
                "read_access" => "read_access",
                "missing_connector" => "missing_connector",
                "sign_in" => "sign_in",
                "permission" => "permission",
                "unsupported_tools" => "unsupported_tools",
                "search_failed" => "search_failed",
                _ => "invalid_result",
            };
        return "cli_error";
    }
}
