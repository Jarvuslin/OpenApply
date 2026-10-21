using System.Text.Json;
using OpenApply.Terminal.Agent;

namespace OpenApply.Terminal.Queue;

internal sealed partial class QueueRuntime
{
    internal const string IdleReason = "No queued work is ready to run.";
    // Per-run ceilings sized so three parallel runs stay inside the grant caps (100M tokens, 1000 requests, $100).
    // Long Workday forms re-read cached context every step, so a run needs tens of millions of counted tokens.
    private static readonly QueueGrantBudget ApplicationRun = new(330, 30_000_000, 6, 330, 200, 25m, 3600);
    private static readonly QueueGrantBudget AccountRun = new(120, 8_000_000, 0, 120, 100, 5m, 1200);
    // Scoring delegates batches of five jobs to job-worker subagents; a run holds at most 50 jobs.
    private static readonly QueueGrantBudget PilotRun = new(200, 15_000_000, 10, 200, 150, 10m, 2400);
    private bool autoGrant;
    private DateTimeOffset nextAutoCheck;

    private bool ApprovalConfigured() =>
        new[] { QueueModelGrant.EnvironmentKey, QueueModelGrant.PreparationEnvironmentKey, QueueModelGrant.AccountEnvironmentKey, QueueModelGrant.PilotEnvironmentKey }
            .Any(key => !string.IsNullOrWhiteSpace(getEnvironment(key)));

    /// <summary>Without an approval file, turn the next runnable wave from the API into a grant.</summary>
    private async Task RefreshAutoGrantAsync(CancellationToken ct)
    {
        ApiConnection? settings;
        var now = DateTimeOffset.UtcNow;
        lock (sync)
        {
            settings = connection;
            if (settings is null || ApprovalConfigured() || now < nextAutoCheck || LaneCount(grant) != 0 || accountHandoffs.Count != 0) return;
            // A wave whose remaining work is all deferred is rebuilt so other queued work can run.
            if (grant is not null && !(autoGrant && (grant.Remaining == 0 || grant.BlockingReason(now) is not null || pollingReason is not null))) return;
            nextAutoCheck = now.AddSeconds(10);
        }
        QueueGrantFile? approval = null;
        try
        {
            var runnable = await api.RunnableAsync(settings, ct);
            if (runnable.AccountIds.FirstOrDefault() is { } accountId)
            {
                // An account whose snapshot is no longer valid must not hold up the applications behind it.
                try
                {
                    var snapshot = await api.AccountSnapshotAsync(settings, accountId, ct);
                    approval = Approval("queue-account-setup", 1, AccountRun, [new(Guid.NewGuid().ToString(), accountId, AccountRun, AccountSetup: snapshot)]);
                }
                catch (Exception ex) when (ex is HttpRequestException or InvalidDataException or JsonException)
                {
                    logger.LogWarning("Skipped account setup {WorkItemId}: its snapshot could not be read.", accountId);
                }
            }
            // Ready applications go first; scoring then runs beside them in the score lane.
            if (approval is null && runnable.ApplicationIds.Length > 0)
            {
                var workers = Math.Clamp(runnable.MaxConcurrentWorkers, 1, 3);
                var order = await api.OrderedAsync(settings, runnable.ApplicationIds, ct);
                var eligible = order.Items.Where(item => item.Eligible).Select(item => item.WorkItemId).ToArray();
                lock (sync) pollingReason = eligible.Length == 0 ? order.Items.FirstOrDefault()?.BlockedReason : null;
                var allocations = eligible.Take(workers)
                    .Select(id => new QueueGrantAllocation(Guid.NewGuid().ToString(), id, ApplicationRun)).ToArray();
                var n = allocations.Length;
                approval = Approval("queue-application", workers, ApplicationRun with
                {
                    MaxRequests = ApplicationRun.MaxRequests * n, MaxTokens = ApplicationRun.MaxTokens * n,
                    MaxSubagents = ApplicationRun.MaxSubagents * n, MaxTurns = ApplicationRun.MaxTurns * n,
                    MaxBudgetUsd = ApplicationRun.MaxBudgetUsd * n, MaxSeconds = 3600,
                }, allocations);
                if (n == 0) approval = null;
            }
            // A scoring run already working beside applications keeps the next one waiting.
            if (approval is null && !ScoreLaneBusy() && runnable.PilotIds.FirstOrDefault() is { } pilotId)
                approval = Approval("queue-pilot-score", 1, PilotRun, [new(Guid.NewGuid().ToString(), pilotId, PilotRun)]);
        }
        catch (Exception ex) when (ex is HttpRequestException or InvalidDataException or JsonException or OperationCanceledException or NotSupportedException)
        {
            if (ct.IsCancellationRequested) throw;
            return;
        }
        lock (sync)
        {
            if (connection != settings || LaneCount(grant) != 0) return;
            if (approval is null)
            {
                if (autoGrant) grant = null;
                return;
            }
            grant = InstallAutoApproval(approval);
            autoGrant = true;
            denied.Clear();
            ClearIdlePlugins();
            lastError = null;
        }
    }

    /// <summary>Writes an automatic approval to disk and reads it back through the same checks as a manual one.</summary>
    private QueueModelGrant? InstallAutoApproval(QueueGrantFile approval)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(approval, AppJsonContext.Default.QueueGrantFile);
        var paths = install.RequirePaths();
        var directory = Path.Combine(paths.ScratchDir, "auto-approvals");
        Directory.CreateDirectory(directory);
        var filename = Path.Combine(directory, approval.RunId + ".json");
        QueueModelGrant.WriteNew(filename, bytes);
        var key = approval.Purpose switch
        {
            "queue-account-setup" => QueueModelGrant.AccountEnvironmentKey,
            "queue-pilot-score" => QueueModelGrant.PilotEnvironmentKey,
            _ => QueueModelGrant.EnvironmentKey,
        };
        return QueueModelGrant.Read(name => name == key ? filename : null, Path.Combine(paths.WorkingDir, "queue-model-evidence"), DateTimeOffset.UtcNow);
    }

    /// <summary>Drops staged plugins, keeping those a running worker still uses.</summary>
    private void ClearIdlePlugins()
    {
        var live = workers.Values.Select(worker => worker.Allocation.AllocationId).ToHashSet();
        foreach (var id in plugins.Keys.Where(id => !live.Contains(id)).ToArray()) plugins.Remove(id);
    }

    private static QueueGrantFile Approval(string purpose, int workers, QueueGrantBudget budget, QueueGrantAllocation[] allocations)
    {
        var now = DateTimeOffset.UtcNow;
        return new(1, true, purpose, Guid.NewGuid().ToString(), "claude", "sonnet", "auto:run-limit",
            now.AddSeconds(-1), now.AddHours(2), true, 0, workers, budget, allocations);
    }
}
