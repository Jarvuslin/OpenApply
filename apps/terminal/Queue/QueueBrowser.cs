using System.Collections.Concurrent;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using OpenApply.Terminal.Agent;
using OpenApply.Terminal.Hosting;
using OpenApply.Terminal.Providers;
using OpenApply.Terminal.Questions;

namespace OpenApply.Terminal.Queue;

internal interface IQueueBrowser
{
    Task<QueueBrowserSession> StartAsync(QueueClaim claim, CancellationToken ct);
}

internal sealed class QueueBrowserSession(string workspace, string companionUrl,
    Func<JsonObject, CancellationToken, Task<JsonObject>> send, Func<Task> close)
{
    internal string Workspace { get; } = workspace;
    internal string CompanionUrl { get; } = companionUrl;
    internal string Capability { get; } = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));
    internal int Port { get; set; }
    internal string OutputDirectory { get; set; } = "";
    internal string? PreparedHash { get; set; }
    internal bool Released { get; set; }
    internal SemaphoreSlim Operation { get; } = new(1, 1);
    internal SemaphoreSlim FrameOperation { get; } = new(1, 1);
    internal QueueFrame? LastFrame { get; set; }
    internal Task<JsonObject> SendAsync(JsonObject input, CancellationToken ct) => send(input, ct);
    internal Task CloseAsync() => close();
    internal Task RenewAsync(DateTimeOffset expiry, CancellationToken ct) => SendAsync(new() { ["action"] = "renew", ["ttlMs"] = Deadline(expiry) }, ct);
    internal static int Deadline(DateTimeOffset expiry)
    {
        var value = (int)(expiry - DateTimeOffset.UtcNow).TotalMilliseconds;
        if (value < 1000) throw new InvalidOperationException("The browser lease has expired.");
        return Math.Min(value, 90000);
    }
}

internal sealed class QueueBrowser(HostInstall install, IConfiguration configuration) : IQueueBrowser
{
    public async Task<QueueBrowserSession> StartAsync(QueueClaim claim, CancellationToken ct)
    {
        var paths = install.RequirePaths();
        var owner = claim.Ownership ?? throw new InvalidDataException("Worker ownership is missing.");
        var preparation = claim.Execution.Preparation?.Snapshot;
        var account = claim.Execution.AccountSetup;
        var endpoint = configuration["Kestrel:Endpoints:Http:Url"] ?? "http://localhost:4102";
        if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var uri) || !uri.IsLoopback || uri.Scheme != "http" || uri.UserInfo.Length != 0)
            throw new InvalidOperationException("Worker controls require a loopback companion endpoint.");
        var workspace = Path.Combine(paths.WorkingDir, "queue-workers", owner.BrowserSessionId);
        var root = Path.GetDirectoryName(workspace)!;
        Directory.CreateDirectory(root);
        if (Directory.GetDirectories(root).Length >= 100 || Directory.Exists(workspace)) throw new InvalidOperationException("Retained worker evidence needs review before another browser can start.");
        Directory.CreateDirectory(workspace);
        var node = ExecutablePath.Find("node") ?? throw new InvalidOperationException("The browser runtime is unavailable.");
        var transport = new QueueBrowserTransport(QuestionBrowser.BuildStart(node, paths, account is null ? "worker-browser.mjs" : "account-browser.mjs"));
        var session = new QueueBrowserSession(workspace, endpoint.TrimEnd('/'), transport.SendAsync, transport.CloseAsync);
        try
        {
            await transport.StartAsync(ct);
            var command = new JsonObject
            {
                ["action"] = "start",
                ["runtimeId"] = owner.RuntimeId,
                ["workerId"] = owner.WorkerId,
                ["executionId"] = owner.ExecutionId,
                ["browserSessionId"] = owner.BrowserSessionId,
                ["workItemId"] = claim.Item.Id,
                ["ttlMs"] = QueueBrowserSession.Deadline(claim.LeaseExpiresAt!.Value),
                ["allowLoopback"] = Environment.GetEnvironmentVariable("OPENAPPLY_QUESTION_ALLOW_LOOPBACK") == "1"
            };
            if (account is not null)
            {
                command["mode"] = "account_setup";
                command["snapshot"] = JsonSerializer.SerializeToNode(account.Snapshot, AppJsonContext.Default.AccountSetupSnapshot);
            }
            else if (claim.Execution.ScorePages is { } pages)
            {
                // A read-only browser limited to the run's own postings; it never carries a job capability.
                command["mode"] = "score";
                command["urls"] = new JsonArray([.. pages.Select(page => (JsonNode)JsonValue.Create(page.Url)!)]);
            }
            else
            {
                command["mode"] = preparation is null ? "application" : "intake_prepare";
                command["jobId"] = preparation?.JobId ?? claim.Item.JobId;
                command["url"] = preparation?.Url ?? claim.Execution.Job!.Url;
            }
            var response = await session.SendAsync(command, ct);
            session.Port = response["port"]!.GetValue<int>();
            session.OutputDirectory = response["outputDir"]!.GetValue<string>();
            session.Released = response["released"]?.GetValue<bool>() == true;
            if ((preparation is null && account is null ? session.Port is < 1024 or > 65535 or 9222 : session.Port != 0) || session.OutputDirectory != "/home/pilot/openapply/queue-workers/" + owner.BrowserSessionId)
                throw new InvalidDataException("The browser returned different worker ownership.");
            return session;
        }
        catch { await transport.CloseAsync(); throw; }
    }
}

internal sealed class QueueBrowserTransport(ProcessStartInfo start)
{
    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonObject>> pending = new();
    private readonly SemaphoreSlim writes = new(1, 1);
    private readonly TaskCompletionSource ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private Process? process;
    private IDisposable? lifetime;
    private Task? reader;
    private Task? stderr;
    private int closed;

    internal async Task StartAsync(CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        process = Process.Start(start) ?? throw new InvalidOperationException("The worker browser could not start.");
        lifetime = AgentProcessLifetime.Attach(process);
        reader = ReadAsync();
        stderr = DrainAsync(process.StandardError);
        await ready.Task.WaitAsync(TimeSpan.FromSeconds(20), ct);
    }

    internal async Task<JsonObject> SendAsync(JsonObject command, CancellationToken ct)
    {
        if (process is null || process.HasExited || Volatile.Read(ref closed) != 0) throw new IOException("The owned browser is unavailable.");
        var id = Guid.NewGuid().ToString();
        command["requestId"] = id;
        var response = new TaskCompletionSource<JsonObject>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!pending.TryAdd(id, response)) throw new InvalidOperationException();
        try
        {
            await writes.WaitAsync(ct);
            try
            {
                var body = command.ToJsonString(AppJsonContext.Default.Options);
                if (body.Length > 16_000_000) throw new InvalidDataException("Worker browser input exceeds its bound.");
                await process.StandardInput.WriteLineAsync(body.AsMemory(), ct);
                await process.StandardInput.FlushAsync(ct);
            }
            finally { writes.Release(); }
            return await response.Task.WaitAsync(TimeSpan.FromSeconds(60), ct);
        }
        finally { pending.TryRemove(id, out _); }
    }

    private async Task ReadAsync()
    {
        try
        {
            while (await process!.StandardOutput.ReadLineAsync() is { } line)
            {
                if (line.Length > 2_000_000) throw new InvalidDataException();
                var message = JsonNode.Parse(line) as JsonObject ?? throw new InvalidDataException();
                if (message["ready"]?.GetValue<bool>() == true) { ready.TrySetResult(); continue; }
                var id = message["requestId"]?.GetValue<string>();
                if (id is null || !pending.TryGetValue(id, out var target)) continue;
                if (message["ok"]?.GetValue<bool>() != true) target.TrySetException(new InvalidOperationException($"Owned browser operation refused or failed ({message["reason"]?.GetValue<string>() ?? "no reason"})."));
                else target.TrySetResult(message["result"] as JsonObject ?? throw new InvalidDataException());
            }
        }
        catch (Exception ex) when (ex is IOException or JsonException or InvalidOperationException) { }
        finally
        {
            ready.TrySetException(new IOException("Owned browser startup failed."));
            foreach (var target in pending.Values) target.TrySetException(new IOException("The owned browser closed."));
        }
    }

    internal async Task CloseAsync()
    {
        if (Interlocked.Exchange(ref closed, 1) != 0 || process is null) return;
        try
        {
            process.StandardInput.Close();
            await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(10));
            if (reader is not null) await reader.WaitAsync(TimeSpan.FromSeconds(1));
            if (stderr is not null) await stderr.WaitAsync(TimeSpan.FromSeconds(1));
            if (process.ExitCode != 0) throw new QuestionBrowserCleanupException();
        }
        catch (Exception ex) when (ex is IOException or TimeoutException or InvalidOperationException)
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            throw new QuestionBrowserCleanupException();
        }
        finally { lifetime?.Dispose(); process.Dispose(); }
    }

    private static async Task DrainAsync(StreamReader input) { var buffer = new char[4096]; while (await input.ReadAsync(buffer) > 0) { } }
}
