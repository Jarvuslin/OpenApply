using System.Net;
using OpenApply.Terminal.Agent;

namespace OpenApply.Terminal.Queue;

internal sealed partial class QueueRuntime
{
    internal static readonly TimeSpan SubmissionFinalizationLimit = TimeSpan.FromSeconds(30);

    private async Task FinishWorkerAsync(ApiConnection settings, Worker worker, AgentResult result, CancellationToken ct)
    {
        if (IsSubmitted(worker)) return;
        try { await api.FinishAsync(settings, worker.Claim, result, ct); }
        catch (HttpRequestException error) when (error.StatusCode == HttpStatusCode.Conflict)
        {
            if (!await BeginSubmittedFinalizationAsync(settings, worker, ct)) throw;
        }
    }

    private async Task PublishWorkerEventAsync(ApiConnection settings, Worker worker, WorkEvent message, CancellationToken ct)
    {
        if (IsSubmitted(worker)) { await CloseWorkerBrowserAsync(worker); return; }
        try { await api.EventAsync(settings, worker.Claim, message, ct); }
        catch (HttpRequestException error) when (error.StatusCode == HttpStatusCode.Conflict)
        {
            if (!await BeginSubmittedFinalizationAsync(settings, worker, ct)) throw;
        }
    }

    private async Task<bool> BeginSubmittedFinalizationAsync(ApiConnection settings, Worker worker, CancellationToken ct)
    {
        string expectedOwner;
        bool submitted;
        lock (sync)
        {
            if (worker.Claim.Item.Kind != "application" || connection != settings || ownerId is null || worker.Stop.IsCancellationRequested) return false;
            submitted = worker.Submitted;
            expectedOwner = ownerId;
        }
        if (submitted) { await CloseWorkerBrowserAsync(worker); return true; }
        var ownership = worker.Claim.Ownership!;
        var observation = await api.ObserverAsync(settings, worker.Claim.Item.Id, ownership.ExecutionId, ownership.BrowserSessionId, ct);
        if (observation.OwnerId != expectedOwner || observation.WorkItemId != worker.Claim.Item.Id
            || observation.ExecutionId != ownership.ExecutionId || observation.BrowserSessionId != ownership.BrowserSessionId
            || observation.CurrentExecutionId != ownership.ExecutionId
            || observation.State != "submitted" || observation.Active || observation.LeaseExpiresAt is not null) return false;
        lock (sync)
        {
            if (connection != settings || ownerId != expectedOwner || worker.Stop.IsCancellationRequested) return false;
            if (!worker.Submitted)
            {
                // Recording ends browser authority before the provider emits its handback and final usage.
                worker.Submitted = true;
                worker.State = "finishing";
                worker.Stop.CancelAfter(SubmissionFinalizationLimit);
            }
        }
        await CloseWorkerBrowserAsync(worker);
        return true;
    }

    private Task CloseWorkerBrowserAsync(Worker worker)
    {
        lock (sync)
            return worker.Browser is null ? Task.CompletedTask : worker.BrowserClose ??= worker.Browser.CloseAsync();
    }

    private bool IsSubmitted(Worker worker) { lock (sync) return worker.Submitted; }
}
