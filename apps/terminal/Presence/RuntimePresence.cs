using System.Net.Http.Headers;
using System.Net.Http.Json;
using OpenApply.Terminal.Agent;
using OpenApply.Terminal.Queue;

namespace OpenApply.Terminal.Presence;

internal sealed record RuntimeHeartbeat(string RuntimeId, string State, bool ExecutionAvailable, string? BlockingCode);
internal sealed record RuntimePresenceSnapshot(ApiConnection? Connection, RuntimeHeartbeat Heartbeat);
internal interface IRuntimePresenceSource { RuntimePresenceSnapshot Presence { get; } }

internal sealed class RuntimePresence(HttpClient http, IRuntimePresenceSource source) : BackgroundService
{
    private ApiConnection? previous;
    private string? runtimeId;

    internal static RuntimeHeartbeat Describe(string id, QueueStatus status)
    {
        var enabled = status.Budget?.Enabled == true;
        if ((status.Workers ?? []).Any(worker => worker.State == "quarantined")) return new(id, "blocked", false, "browser_unavailable");
        if (status.LastError is not null) return new(id, "blocked", false, "runtime_error");
        if (status.Running) return new(id, "busy", enabled, enabled ? null : "budget_exhausted");
        if (!enabled) return new(id, "blocked", false, "model_approval_required");
        return new(id, "ready", true, null);
    }

    internal async Task PublishAsync(CancellationToken ct)
    {
        var current = source.Presence;
        if (previous is not null && previous != current.Connection)
            await SendAsync(previous, new(runtimeId!, "stopped", false, null), ct);
        previous = current.Connection; runtimeId = current.Heartbeat.RuntimeId;
        if (current.Connection is not null) await SendAsync(current.Connection, current.Heartbeat, ct);
    }

    private async Task SendAsync(ApiConnection connection, RuntimeHeartbeat heartbeat, CancellationToken ct)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(TimeSpan.FromSeconds(5));
        using var request = new HttpRequestMessage(HttpMethod.Post, connection.ApiUrl + "/api/runtime/presence");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", connection.ApiToken);
        request.Content = JsonContent.Create(heartbeat, AppJsonContext.Default.RuntimeHeartbeat);
        try { using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token); }
        catch (Exception ex) when (ex is HttpRequestException or OperationCanceledException) { }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var nextBeat = DateTimeOffset.MinValue;
        try { while (!stoppingToken.IsCancellationRequested) { if (source.Presence.Connection != previous || DateTimeOffset.UtcNow >= nextBeat) { await PublishAsync(stoppingToken); nextBeat = DateTimeOffset.UtcNow.AddSeconds(30); } await Task.Delay(TimeSpan.FromSeconds(1), stoppingToken); } }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
        finally { if (previous is not null) await SendAsync(previous, new(runtimeId!, "stopped", false, null), CancellationToken.None); }
    }
}
