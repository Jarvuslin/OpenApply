using OpenApply.Terminal.Agent;

namespace OpenApply.Terminal.Queue;

internal sealed partial class QueueRuntime
{
    private QueueModelGrant? scoreGrant;
    private DateTimeOffset nextScoreCheck;

    private bool ScoreLaneBusy()
    {
        lock (sync) return scoreGrant is not null && LaneCount(scoreGrant) != 0;
    }

    /// <summary>
    /// While applications run, one scoring run may work beside them, so the next jobs are scored
    /// before the current ones finish. Only automatic approvals use this lane; a manual approval
    /// file keeps the one-run-at-a-time behaviour.
    /// </summary>
    private async Task RunScoreLaneAsync(CancellationToken ct)
    {
        ApiConnection? settings;
        var now = DateTimeOffset.UtcNow;
        lock (sync)
        {
            settings = connection;
            if (settings is null || !autoGrant || ApprovalConfigured() || !ownsGate || now < nextScoreCheck || BlockingReason() is not null
                || grant is not { IsPilotScore: false, IsAccountSetup: false, IsPreparation: false }
                || LaneCount(grant) == 0 || (scoreGrant is not null && LaneCount(scoreGrant) != 0)) return;
            nextScoreCheck = now.AddSeconds(15);
        }
        QueueModelGrant? lane = null;
        QueueGrantAllocation? allocation = null;
        try
        {
            var runnable = await api.RunnableAsync(settings, ct);
            if (runnable.PilotIds.FirstOrDefault() is not { } pilotId) return;
            lock (sync)
            {
                if (connection != settings || !ownsGate || LaneCount(grant) == 0) return;
                lane = InstallAutoApproval(Approval("queue-pilot-score", 1, PilotRun, [new(Guid.NewGuid().ToString(), pilotId, PilotRun)]));
                if (lane is null) return;
                scoreGrant = lane;
                PrepareGrant(lane);
                allocation = lane.Reserve(pilotId);
            }
        }
        catch (Exception ex) when (ex is IOException or InvalidDataException or System.Text.Json.JsonException or UnauthorizedAccessException or ModelBudgetException or HttpRequestException or InvalidOperationException)
        {
            // A scoring run that can't start leaves the applications running; the batch waits for the next turn.
            lane?.Cancel("The scoring run beside applications could not be approved.");
            logger.LogWarning("Skipped a scoring run beside applications ({FailureType}).", ex.GetType().Name);
            return;
        }
        if (allocation is not null) await ClaimAndStartAsync(settings, lane!, allocation, ct);
    }
}
