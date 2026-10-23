using System.Text.Json.Nodes;
using OpenApply.Terminal.Agent;

namespace OpenApply.Terminal.Queue;

internal sealed record AccountHandoffStatus(bool Available, string? ViewerUrl, DateTimeOffset? ExpiresAt);

internal sealed partial class QueueRuntime
{
    internal static readonly TimeSpan AccountHandoffLimit = TimeSpan.FromMinutes(15);
    private sealed class AccountHandoff(Worker worker, ApiConnection settings, string owner, DateTimeOffset expires)
    {
        internal Worker Worker { get; } = worker;
        internal ApiConnection Settings { get; } = settings;
        internal string Owner { get; } = owner;
        internal DateTimeOffset Expires { get; } = expires;
        internal CancellationTokenSource Stop { get; } = new(AccountHandoffLimit);
        internal Task Monitor { get; set; } = Task.CompletedTask;
    }
    private readonly Dictionary<string, AccountHandoff> accountHandoffs = [];

    private async Task ParkAccountHandoffAsync(ApiConnection settings, Worker worker, CancellationToken ct)
    {
        string expectedOwner;
        lock (sync) expectedOwner = connection == settings && ownerId is not null ? ownerId : throw new InvalidOperationException("The account connection changed.");
        var owned = worker.Claim.Ownership!;
        var observation = await api.ObserverAsync(settings, worker.Claim.Item.Id, owned.ExecutionId, owned.BrowserSessionId, ct);
        ValidateHandoffObserver(observation, expectedOwner, worker.Claim);
        var parked = await worker.Browser!.SendAsync(new JsonObject { ["action"] = "park", ["ttlMs"] = (int)AccountHandoffLimit.TotalMilliseconds }, ct);
        if (parked["parked"]?.GetValue<bool>() != true || parked["submissionAllowed"]?.GetValue<bool>() != false)
            throw new InvalidDataException("The restricted account handoff was not confirmed.");
        var handoff = new AccountHandoff(worker, settings, expectedOwner, DateTimeOffset.UtcNow + AccountHandoffLimit);
        lock (sync)
        {
            if (connection != settings || ownerId != expectedOwner || accountHandoffs.ContainsKey(worker.Claim.Item.Id)) throw new InvalidOperationException("Account handoff ownership changed.");
            accountHandoffs.Add(worker.Claim.Item.Id, handoff);
            handoff.Monitor = MonitorAccountHandoffAsync(handoff);
        }
    }

    private async Task MonitorAccountHandoffAsync(AccountHandoff handoff)
    {
        try
        {
            while (!handoff.Stop.IsCancellationRequested)
            {
                await Task.Delay(TimeSpan.FromSeconds(2), handoff.Stop.Token);
                lock (sync) if (connection != handoff.Settings || ownerId != handoff.Owner) break;
                var claim = handoff.Worker.Claim;
                var owned = claim.Ownership!;
                var observation = await api.ObserverAsync(handoff.Settings, claim.Item.Id, owned.ExecutionId, owned.BrowserSessionId, handoff.Stop.Token);
                ValidateHandoffObserver(observation, handoff.Owner, claim);
            }
        }
        catch (Exception ex) when (ex is OperationCanceledException or HttpRequestException or IOException or InvalidOperationException) { }
        finally
        {
            try { await CloseWorkerBrowserAsync(handoff.Worker); }
            catch
            {
                lock (sync)
                {
                    lastError = "Account handoff cleanup is uncertain; inspect the retained browser before another launch.";
                    handoff.Worker.State = "quarantined";
                    workers[handoff.Worker.Claim.Ownership!.BrowserSessionId] = handoff.Worker;
                }
            }
            lock (sync) accountHandoffs.Remove(handoff.Worker.Claim.Item.Id);
        }
    }

    internal static void ValidateHandoffObserver(QueueObserver observation, string expectedOwner, QueueClaim claim)
    {
        var owned = claim.Ownership!;
        if (observation.OwnerId != expectedOwner || observation.WorkItemId != claim.Item.Id || observation.ExecutionId != owned.ExecutionId
            || observation.BrowserSessionId != owned.BrowserSessionId || observation.CurrentExecutionId != owned.ExecutionId
            || observation.State != "needs_user" || observation.Active || observation.LeaseExpiresAt is not null)
            throw new InvalidOperationException("The expected human account handoff is unavailable.");
    }

    private async Task CloseAccountHandoffAsync(string workItemId)
    {
        AccountHandoff? handoff;
        lock (sync) accountHandoffs.TryGetValue(workItemId, out handoff);
        if (handoff is null) return;
        await handoff.Stop.CancelAsync();
        await handoff.Monitor;
        handoff.Stop.Dispose();
    }

    private async Task CloseAllAccountHandoffsAsync()
    {
        string[] ids;
        lock (sync) ids = [.. accountHandoffs.Keys];
        foreach (var id in ids) await CloseAccountHandoffAsync(id);
    }

    internal async Task<AccountHandoffStatus> AccountHandoffAsync(string workItemId, string token, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > 16000 || token.Any(char.IsControl)) throw new InvalidOperationException("An authenticated account viewer is required.");
        AccountHandoff? handoff;
        lock (sync) accountHandoffs.TryGetValue(workItemId, out handoff);
        if (handoff is null) return new(false, null, null);
        var claim = handoff.Worker.Claim;
        var owned = claim.Ownership!;
        var observed = await api.ObserverAsync(handoff.Settings with { ApiToken = token }, workItemId, owned.ExecutionId, owned.BrowserSessionId, ct);
        ValidateHandoffObserver(observed, handoff.Owner, claim);
        lock (sync)
            if (handoff.Stop.IsCancellationRequested || DateTimeOffset.UtcNow >= handoff.Expires || !accountHandoffs.TryGetValue(workItemId, out var current) || current != handoff)
                return new(false, null, null);
        return new(true, "http://localhost:6080/vnc.html", handoff.Expires);
    }
}
