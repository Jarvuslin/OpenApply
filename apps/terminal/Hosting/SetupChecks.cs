using System.Diagnostics;
using System.Text.Json.Nodes;
using OpenApply.Terminal.Providers;
using OpenApply.Terminal.Sessions;

namespace OpenApply.Terminal.Hosting;

/// <summary>The doctor's JSON on success, or why it could not run.</summary>
internal sealed record SetupChecksResult(string? Json, string? Error);

/// <summary>Runs <c>node scripts/openapply.mjs doctor --json</c> from the source checkout for the web's Setup page.</summary>
internal sealed class SetupChecks
{
    private static readonly TimeSpan CacheFor = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan RunTimeout = TimeSpan.FromSeconds(90);

    private readonly Func<string, CancellationToken, Task<string?>> runDoctor;
    private readonly string? root;
    private readonly SemaphoreSlim gate = new(1, 1);
    private SetupChecksResult? cached;
    private DateTimeOffset cachedAt;

    public SetupChecks(HostInstall install, ILogger<SetupChecks> logger)
        : this(install.Paths?.WorkingDir, (scriptRoot, ct) => RunNodeAsync(scriptRoot, logger, ct)) { }

    internal SetupChecks(string? root, Func<string, CancellationToken, Task<string?>> runDoctor)
    {
        this.root = root;
        this.runDoctor = runDoctor;
    }

    internal static string? ScriptRoot(string? root) =>
        root is not null && File.Exists(Path.Combine(root, "scripts", "openapply.mjs")) ? root : null;

    public async Task<SetupChecksResult> GetAsync(CancellationToken ct)
    {
        if (ScriptRoot(root) is not { } scriptRoot)
            return new(null, "Setup checks need a source checkout with scripts/openapply.mjs.");
        // One doctor run at a time; callers inside the cache window share its result.
        await gate.WaitAsync(ct);
        try
        {
            if (cached is not null && DateTimeOffset.UtcNow - cachedAt < CacheFor) return cached;
            var output = await runDoctor(scriptRoot, ct);
            var result = Parse(output);
            if (result.Json is not null)
            {
                cached = result;
                cachedAt = DateTimeOffset.UtcNow;
            }
            return result;
        }
        finally
        {
            gate.Release();
        }
    }

    internal static SetupChecksResult Parse(string? output)
    {
        if (string.IsNullOrWhiteSpace(output)) return new(null, "The doctor produced no output.");
        try
        {
            // The doctor exits 1 when a required check fails, so only the JSON shape decides success.
            if (JsonNode.Parse(output) is JsonObject json && json["checks"] is JsonArray)
                return new(json.ToJsonString(), null);
        }
        catch (System.Text.Json.JsonException)
        {
        }
        return new(null, "The doctor's output was not the expected JSON.");
    }

    private static async Task<string?> RunNodeAsync(string scriptRoot, ILogger logger, CancellationToken ct)
    {
        if (ExecutablePath.Find("node") is not { } node)
        {
            logger.LogWarning("Setup checks skipped: node is not on PATH.");
            return null;
        }
        var start = new ProcessStartInfo(node)
        {
            WorkingDirectory = scriptRoot,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        foreach (var argument in new[] { Path.Combine("scripts", "openapply.mjs"), "doctor", "--json" })
            start.ArgumentList.Add(argument);
        // A PATH refreshed from the registry finds tools installed after the host started.
        foreach (var (name, value) in PtyEnvironment.BuildOverrides()) start.Environment[name] = value;

        using var process = Process.Start(start);
        if (process is null) return null;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(RunTimeout);
        try
        {
            var stdout = process.StandardOutput.ReadToEndAsync(timeout.Token);
            _ = process.StandardError.ReadToEndAsync(timeout.Token);
            await process.WaitForExitAsync(timeout.Token);
            return await stdout;
        }
        catch (OperationCanceledException)
        {
            process.Kill(entireProcessTree: true);
            logger.LogWarning("Setup checks timed out after {Seconds}s.", RunTimeout.TotalSeconds);
            return null;
        }
    }
}
