using System.Text.Json;
using System.Text.Json.Serialization;
using OpenApply.Terminal.Agent;

namespace OpenApply.Terminal.Queue;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed record AccountLaunchRequest(string ExpectedOwnerId, string ConnectionId, AccountSetupSnapshot Snapshot,
    QueueGrantBudget Budget, string ApprovalReference, bool AcceptObservedLimitOvershoot);

internal sealed partial class QueueRuntime
{
    internal async Task<QueueStatus> LaunchAccountAsync(AccountLaunchRequest request, string token, CancellationToken ct)
    {
        if (!Guid.TryParseExact(request.ExpectedOwnerId, "D", out _) || !Guid.TryParseExact(request.ConnectionId, "D", out _)
            || string.IsNullOrWhiteSpace(token) || token.Length > 16000 || token.Any(char.IsControl)) throw new InvalidOperationException("A current authenticated connection is required.");
        QueueModelGrant.ValidateAccountSnapshot(request.Snapshot, request.Snapshot.WorkItemId, "claude");
        ApiConnection settings;
        lock (sync)
        {
            _ = BlockingReason();
            if (connection is null || ownerId != request.ExpectedOwnerId || connectionId != request.ConnectionId || workers.Count != 0)
                throw new InvalidOperationException("The connected account changed or work is still running.");
            if (accountHandoffs.Keys.Any(id => id != request.Snapshot.WorkItemId)) throw new InvalidOperationException("Complete the existing account handoff first.");
            if (grant is not null && grant.Remaining > 0 && grant.BlockingReason(DateTimeOffset.UtcNow) is null)
                throw new InvalidOperationException("An approved queue allocation is still pending.");
            var hostBudget = ModelBudget.Read(getEnvironment);
            if (hostBudget is { MaxRequests: 0 } || hostBudget?.LedgerPath is { } ledger && File.Exists(ledger)) throw new InvalidOperationException("Model execution is disabled by this host budget.");
            settings = connection;
        }
        var authenticated = settings with { ApiToken = token };
        if (await api.VerifyAsync(authenticated, ct) != request.ExpectedOwnerId) throw new InvalidOperationException("The launch belongs to another signed-in account.");
        var snapshot = await api.AccountSnapshotAsync(authenticated, request.Snapshot.WorkItemId, ct);
        if (snapshot != request.Snapshot) throw new InvalidOperationException("Account setup changed; review its current snapshot before launching.");
        var now = DateTimeOffset.UtcNow;
        var approved = new QueueGrantFile(1, true, "queue-account-setup", Guid.NewGuid().ToString(), "claude", "sonnet", request.ApprovalReference,
            now, now.AddMinutes(15), request.AcceptObservedLimitOvershoot, 0, 1, request.Budget,
            [new(Guid.NewGuid().ToString(), snapshot.WorkItemId, request.Budget, AccountSetup: snapshot)]);
        var bytes = JsonSerializer.SerializeToUtf8Bytes(approved, AppJsonContext.Default.QueueGrantFile);
        QueueModelGrant.Validate(bytes, now, account: true);
        lock (sync)
        {
            ct.ThrowIfCancellationRequested();
            if (connection != settings || ownerId != request.ExpectedOwnerId || connectionId != request.ConnectionId || workers.Count != 0)
                throw new InvalidOperationException("The launch connection changed.");
            if (grant is not null && grant.Remaining > 0 && grant.BlockingReason(DateTimeOffset.UtcNow) is null)
                throw new InvalidOperationException("Another queue launch was already approved.");
            var paths = install.RequirePaths();
            var directory = Path.Combine(paths.ScratchDir, "account-approvals");
            Directory.CreateDirectory(directory);
            var filename = Path.Combine(directory, approved.RunId + ".json");
            QueueModelGrant.WriteNew(Path.Combine(directory, snapshot.WorkItemId + "." + snapshot.SnapshotHash + ".request"), System.Text.Encoding.UTF8.GetBytes(approved.RunId));
            QueueModelGrant.WriteNew(filename, bytes);
            grant = QueueModelGrant.Read(key => key == QueueModelGrant.AccountEnvironmentKey ? filename : null, Path.Combine(paths.WorkingDir, "queue-model-evidence"), now);
            denied.Clear();
            plugins.Clear();
            lastError = null;
            pollingReason = null;
            return Status;
        }
    }
}
