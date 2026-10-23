using OpenApply.Terminal.Agent;
using OpenApply.Terminal.Hosting;
using OpenApply.Terminal.Questions;
using OpenApply.Terminal.Sessions;
using OpenApply.Terminal.Presence;

namespace OpenApply.Terminal.Queue;

internal sealed partial class QueueRuntime(IQueueApi api, IAgentProcess process, AgentRuntimeGate gate,
    TerminalSession terminal, ILogger<QueueRuntime> logger, IQueueBrowser browser, HostInstall install,
    Func<string, string?>? environment = null, IAccountBrokerApi? accountApi = null) : BackgroundService, IRuntimePresenceSource
{
    private sealed class Worker(QueueClaim claim, QueueGrantAllocation allocation, CancellationTokenSource stop, QueueModelGrant grant)
    {
        internal readonly QueueClaim Claim = claim;
        internal readonly QueueModelGrant Grant = grant;
        internal readonly QueueGrantAllocation Allocation = allocation;
        internal readonly CancellationTokenSource Stop = stop;
        internal QueueBrowserSession? Browser;
        internal Task? BrowserClose;
        internal bool Submitted;
        internal readonly HashSet<string> AccountMutations = [];
        internal Task Task = Task.CompletedTask;
        internal string State = "starting";
    }
    private readonly Lock sync = new();
    private readonly Func<string, string?> getEnvironment = environment ?? Environment.GetEnvironmentVariable;
    private readonly string runtimeId = Guid.NewGuid().ToString();
    private readonly Dictionary<string, Worker> workers = [];
    private readonly Dictionary<string, (int Attempts, DateTimeOffset Next)> denied = [];
    private readonly Dictionary<string, QueuePluginStage> plugins = [];
    private ApiConnection? connection;
    private string? ownerId;
    private string? connectionId;
    private QueueModelGrant? grant;
    private string? lastError;
    private string? pollingReason;
    private bool ownsGate;

    public RuntimePresenceSnapshot Presence
    {
        get { lock (sync) return new(connection, RuntimePresence.Describe(runtimeId, Status)); }
    }
    public QueueStatus Status
    {
        get
        {
            lock (sync)
            {
                var blocking = BlockingReason();
                var reason = blocking == IdleReason ? null : blocking;
                var active = workers.Values.Select(worker => new QueueWorkerStatus(worker.Claim.Ownership!.WorkerId, worker.Claim.Ownership.Slot,
                    worker.Claim.Item.Id, worker.Claim.Ownership.ExecutionId, worker.Claim.Ownership.BrowserSessionId, worker.State)).ToArray();
                var capacity = grant?.Approval.MaxConcurrentWorkers ?? 1;
                // A deferred job (pacing, open questions) is not a computer problem, so it is reported as the budget note.
                return new(connection is not null, active.Length > 0, reason, lastError,
                    capacity, reason is null ? capacity : 0, active, new(reason is null, grant?.Remaining ?? 0, reason ?? pollingReason), ownerId, connectionId);
            }
        }
    }

    public async Task ConnectAsync(ConnectRequest request, CancellationToken ct)
    {
        var next = new ApiConnection(request.ApiToken, request.ApiUrl.TrimEnd('/'), request.WebUrl.TrimEnd('/'));
        var nextOwner = await api.VerifyAsync(next, ct);
        lock (sync)
        {
            if ((workers.Count != 0 || accountHandoffs.Count != 0) && (connection != next || ownerId != nextOwner)) throw new InvalidOperationException("Queue work is active. Wait for it to finish before changing the connection.");
            connection = next; ownerId = nextOwner; connectionId = Guid.NewGuid().ToString(); lastError = null; pollingReason = null;
        }
    }

    internal async Task DisconnectAuthenticatedAsync(string expectedOwnerId, string expectedConnectionId, string token, CancellationToken ct)
    {
        if (!Guid.TryParseExact(expectedOwnerId, "D", out _) || !Guid.TryParseExact(expectedConnectionId, "D", out _)
            || string.IsNullOrWhiteSpace(token) || token.Length > 16000 || token.Any(char.IsControl))
            throw new InvalidOperationException("An authenticated current connection is required.");
        ApiConnection settings;
        lock (sync)
        {
            if (connection is null || ownerId != expectedOwnerId || connectionId != expectedConnectionId)
                throw new InvalidOperationException("This connection has changed. Refresh its state before disconnecting.");
            settings = connection;
        }
        var authenticatedOwner = await api.VerifyAsync(settings with { ApiToken = token }, ct);
        ct.ThrowIfCancellationRequested();
        lock (sync)
        {
            if (authenticatedOwner != expectedOwnerId || connection != settings || ownerId != expectedOwnerId || connectionId != expectedConnectionId)
                throw new InvalidOperationException("This account or connection has changed. No worker was stopped.");
            Disconnect();
        }
    }

    internal void Disconnect()
    {
        lock (sync)
        {
            connection = null;
            ownerId = null;
            connectionId = null;
            grant?.Cancel("The approved queue run was disconnected; no allocation may be retried.");
            scoreGrant?.Cancel("The approved queue run was disconnected; no allocation may be retried.");
            foreach (var worker in workers.Values.Where(worker => worker.State != "quarantined")) worker.Stop.Cancel();
            foreach (var handoff in accountHandoffs.Values) handoff.Stop.Cancel();
        }
    }

    private string? BlockingReason()
    {
        try
        {
            var budget = ModelBudget.Read(getEnvironment);
            if (budget is { MaxRequests: 0 }) return "Model execution is disabled by the host budget.";
            if (budget?.LedgerPath is { } ledger && File.Exists(ledger)) return "Model execution is disabled because this host budget has already been used.";
            if (terminal.IsRunning) return "A legacy terminal session is open. Stop it before starting queue work.";
            if (grant is null)
            {
                if (!ApprovalConfigured()) return IdleReason;
                grant = QueueModelGrant.Read(getEnvironment, Path.Combine(install.RequirePaths().WorkingDir, "queue-model-evidence"), DateTimeOffset.UtcNow);
            }
            if (grant?.IsPreparation == true && !process.PreparationIsolationVerified) return QueueModelGrant.PreparationIsolationReason;
            return grant?.BlockingReason(DateTimeOffset.UtcNow) ?? (grant is null ? IdleReason : null);
        }
        catch (Exception ex) when (ex is ModelBudgetException or IOException or UnauthorizedAccessException or InvalidOperationException)
        { return "Model execution is disabled because the host budget or queue approval is invalid."; }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                await RefreshAutoGrantAsync(stoppingToken);
                ApiConnection? settings;
                QueueGrantAllocation? allocation = null;
                string[] candidates = [];
                lock (sync)
                {
                    settings = connection;
                    if (settings is not null && BlockingReason() is null && LaneCount(grant) < grant!.Approval.MaxConcurrentWorkers)
                        candidates = grant.PendingIds.Where(id => !denied.TryGetValue(id, out var delay) || delay.Next <= DateTimeOffset.UtcNow).ToArray();
                }
                if (candidates.Length > 0)
                {
                    try
                    {
                        using var orderStop = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken, grant!.Stop.Token);
                        var order = await api.OrderedAsync(settings!, candidates, orderStop.Token);
                        if (order.Items.Length != candidates.Length || order.Items.Select(item => item.WorkItemId).Distinct().Count() != candidates.Length
                            || !order.Items.Select(item => item.WorkItemId).ToHashSet().SetEquals(candidates)) throw new InvalidDataException("Queue priority changed the approved work set.");
                        lock (sync)
                        {
                            var selected = order.Items.FirstOrDefault(item => item.Eligible);
                            pollingReason = selected is null ? order.Items.FirstOrDefault()?.BlockedReason : null;
                            foreach (var item in order.Items.Where(item => !item.Eligible)) denied[item.WorkItemId] = (denied.GetValueOrDefault(item.WorkItemId).Attempts, item.NextEligibleAt ?? DateTimeOffset.UtcNow.AddSeconds(10));
                            if (selected is not null && connection == settings && BlockingReason() is null)
                            {
                                if (!ownsGate) ownsGate = gate.TryAcquireQueue();
                                if (ownsGate)
                                {
                                    PrepareGrant(grant); allocation = grant.Reserve(selected.WorkItemId);
                                }
                            }
                        }
                    }
                    catch (Exception ex) when (ex is IOException or InvalidDataException or System.Text.Json.JsonException or UnauthorizedAccessException or ModelBudgetException or HttpRequestException or InvalidOperationException or OperationCanceledException)
                    { grant!.Cancel("The approved queue order or approval latch could not be verified; no worker may start."); lock (sync) lastError = "The exact approved work order could not be verified. Review the retained approval before another run."; }
                }
                if (allocation is not null) await ClaimAndStartAsync(settings!, grant!, allocation, stoppingToken);
                await RunScoreLaneAsync(stoppingToken);
                lock (sync) { if (ownsGate && workers.Count == 0 && accountHandoffs.Count == 0) { gate.ReleaseQueue(); ownsGate = false; } }
                await Task.Delay(TimeSpan.FromMilliseconds(250), stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
        finally
        {
            Worker[] active;
            lock (sync) { active = workers.Values.ToArray(); foreach (var worker in active.Where(worker => worker.State != "quarantined")) worker.Stop.Cancel(); }
            await Task.WhenAll(active.Select(worker => worker.Task));
            await CloseAllAccountHandoffsAsync();
            lock (sync) { if (ownsGate && workers.Count == 0) { gate.ReleaseQueue(); ownsGate = false; } }
        }
    }

    /// <summary>Validates every finite allocation before consuming the approval or claiming any work.</summary>
    private void PrepareGrant(QueueModelGrant owner)
    {
        foreach (var approved in owner.Approval.Allocations)
        {
            var budget = owner.BudgetFor(approved);
            if (!plugins.TryGetValue(approved.AllocationId, out var plugin))
            {
                var paths = install.RequirePaths();
                plugin = QueuePluginStage.Create(paths.PluginDir, Path.Combine(paths.ScratchDir, "queue-plugin-staging"), budget);
                plugins.Add(approved.AllocationId, plugin);
            }
            plugin.Verify(budget);
        }
        owner.Activate(DateTimeOffset.UtcNow);
    }

    private int LaneCount(QueueModelGrant? owner) => workers.Values.Count(worker => worker.Grant == owner);

    private async Task ClaimAndStartAsync(ApiConnection settings, QueueModelGrant owner, QueueGrantAllocation allocation, CancellationToken stoppingToken)
    {
        try
        {
            using var claimStop = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken, owner.Stop.Token);
            var input = new QueueClaimRequest(Guid.NewGuid().ToString(), runtimeId, Guid.NewGuid().ToString(), allocation.WorkItemId,
                new(AccountSetup: allocation.AccountSetup is null ? null : true), allocation.Preparation?.SnapshotHash, allocation.AccountSetup?.SnapshotHash);
            var response = await api.ClaimAsync(settings, input, claimStop.Token);
            lock (sync) pollingReason = response.BlockedReason;
            if (response.Claim is not { } claim)
            {
                var attempts = denied.GetValueOrDefault(allocation.WorkItemId).Attempts + 1;
                denied[allocation.WorkItemId] = (attempts, response.NextEligibleAt ?? DateTimeOffset.UtcNow.AddSeconds(10));
                if (attempts >= 5) owner.Finish(allocation); else owner.NoClaim(allocation);
            }
            else
            {
                QueueApi.ValidateClaim(claim);
                if (claim.Item.Id != allocation.WorkItemId || claim.Execution.Provider != owner.Approval.Provider
                    || claim.Ownership!.RuntimeId != runtimeId || claim.Ownership.WorkerId != input.WorkerId)
                    throw new InvalidDataException("The queue claim does not match its exact approved allocation.");
                ValidateAllocation(claim, allocation, owner);
                var stop = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken, owner.Stop.Token);
                var worker = new Worker(claim, allocation, stop, owner);
                lock (sync)
                {
                    if (workers.Values.Any(other => other.Claim.Ownership!.Slot == claim.Ownership.Slot || other.Claim.Ownership.BrowserSessionId == claim.Ownership.BrowserSessionId)) throw new InvalidDataException("The API reused active browser ownership.");
                    workers.Add(claim.Ownership.BrowserSessionId, worker);
                    if (connection != settings) stop.Cancel();
                }
                worker.Task = RunAsync(settings, worker);
            }
        }
        catch (Exception ex)
        {
            owner.Finish(allocation);
            owner.Cancel("Queue claiming stopped with an uncertain outcome; review the work item before a new approval.");
            lock (sync) lastError = "The exact claim could not be confirmed. No model retry or different work claim was started.";
            logger.LogWarning("Queue claim stopped ({FailureType}).", ex.GetType().Name);
        }
    }

    private async Task RunAsync(ApiConnection settings, Worker worker)
    {
        var claim = worker.Claim;
        var run = worker.Stop;
        var cancelled = false;
        var paused = false;
        var lost = false;
        var quarantine = false;
        AgentResult result = new("interrupted", "The account or application worker did not complete.");
        using var heartbeatStop = CancellationTokenSource.CreateLinkedTokenSource(run.Token);
        var heartbeat = HeartbeatAsync(settings, worker, heartbeatStop.Token, () => cancelled = true, () => paused = true, () => lost = true);
        try
        {
            run.Token.ThrowIfCancellationRequested();
            var plugin = plugins[worker.Allocation.AllocationId];
            plugin.Verify(worker.Grant.BudgetFor(worker.Allocation));
            await CloseAccountHandoffAsync(claim.Item.Id);
            worker.Browser = await browser.StartAsync(claim, run.Token);
            lock (sync)
            {
                run.Token.ThrowIfCancellationRequested();
                if (worker.Submitted) throw new OperationCanceledException(run.Token);
                worker.State = "running";
            }
            var agentSettings = claim.Execution.Preparation is { } preparation ? settings with { ApiToken = preparation.ApiToken } : settings;
            if (claim.Execution.AccountSetup is { } account) agentSettings = settings with { ApiToken = account.ApiToken };
            var budget = worker.Grant.Launch(worker.Allocation);
            budget = budget with { UsageContext = budget.UsageContext! with { ExecutionId = claim.Ownership!.ExecutionId, PluginSourceHash = plugin.SourceHash } };
            result = await process.RunAsync(agentSettings, claim.Request with { Budget = budget, Browser = worker.Browser, PluginStage = plugin }, async entry =>
            {
                var message = QueueRedaction.Event(claim, entry, settings.ApiToken, worker.Browser.Capability, agentSettings.ApiToken);
                if (!string.IsNullOrWhiteSpace(message.Content)) await PublishWorkerEventAsync(settings, worker, message, run.Token);
            }, run.Token);
            if (claim.Execution.AccountSetup is not null) result = await AccountCompletionAsync(agentSettings, worker, result, run.Token);
            if (!result.UsageKnown || result.Status is not ("completed" or "waiting")) worker.Grant.Cancel("A worker stopped or returned unknown usage; the shared approved run stopped without retries.");
        }
        catch (OperationCanceledException)
        {
            worker.Grant.Cancel("A worker stopped with unknown final usage; the shared approved run stopped without retries.");
            result = new(cancelled ? "cancelled" : "interrupted", "The worker stopped. Inspect saved application state before continuing; no automatic retry was started.");
        }
        catch (Exception ex)
        {
            quarantine = ex is QuestionBrowserCleanupException;
            logger.LogWarning("Queue worker stopped ({FailureType}: {Message}).", ex.GetType().Name, ex.Message);
            result = new("interrupted", "The worker stopped unexpectedly. Inspect its saved application state before continuing.");
            worker.Grant.Cancel("A worker failed; the shared approved run stopped without retries.");
        }
        finally
        {
            lock (sync) worker.State = "stopping";
            await heartbeatStop.CancelAsync();
            try { await heartbeat; } catch (OperationCanceledException) { }
            if (worker.Browser is not null && !(claim.Execution.AccountSetup is not null && !lost && !cancelled && !paused && result?.Status == "waiting" && result.UsageKnown))
            {
                try { await CloseWorkerBrowserAsync(worker); }
                catch { quarantine = true; worker.Grant.Cancel("Browser cleanup is uncertain. Restart and review retained evidence before another approval."); }
            }
        }
        try
        {
            if (!lost)
            {
                var status = paused || result.Status == "interrupted" ? "waiting" : result.Status;
                if (status is not ("completed" or "failed" or "cancelled" or "waiting")) status = "failed";
                var error = result.Error is null ? null : QueueRedaction.Clean(result.Error, settings.ApiToken, claim.LeaseToken);
                if (claim.Execution.AccountSetup is not null && error is not null) error = "The account worker stopped. Inspect the saved account phase before continuing.";
                using var finish = new CancellationTokenSource(TimeSpan.FromSeconds(3));
                await FinishWorkerAsync(settings, worker, new(status, error?[..Math.Min(error.Length, 4000)]), finish.Token);
                if (claim.Execution.AccountSetup is not null && status == "waiting" && worker.Browser is not null && worker.BrowserClose is null && result.UsageKnown)
                    await ParkAccountHandoffAsync(settings, worker, finish.Token);
            }
        }
        catch
        {
            if (worker.Browser is not null) { try { await CloseWorkerBrowserAsync(worker); } catch { quarantine = true; } }
            worker.Grant.Cancel("Saving a worker outcome failed; inspect the retained application before another approval."); lock (sync) lastError = "The outcome could not be saved. The expired item will not be replayed.";
        }
        finally
        {
            worker.Grant.Finish(worker.Allocation);
            lock (sync) { if (quarantine) worker.State = "quarantined"; else workers.Remove(claim.Ownership!.BrowserSessionId); }
            run.Dispose();
        }
    }

    internal static void ValidateAllocation(QueueClaim claim, QueueGrantAllocation allocation, QueueModelGrant grant)
    {
        var valid = claim.Item.Kind == "application" && claim.Execution.Preparation is null && claim.Execution.AccountSetup is null;
        if (grant.IsPreparation) valid = claim.Execution.Preparation?.Snapshot == allocation.Preparation && claim.Execution.Intent == "intake_prepare" && claim.Item.Kind == "pilot_task" && claim.Execution.AccountSetup is null;
        if (grant.IsAccountSetup) valid = claim.Execution.AccountSetup?.Snapshot == allocation.AccountSetup && claim.Execution.Intent == "account_setup" && claim.Item.Kind == "pilot_task" && claim.Execution.Preparation is null;
        // Scoring reads and patches jobs the pilot already chose; it never carries a job, account or preparation capability.
        if (grant.IsPilotScore) valid = claim.Execution.Intent == "pilot_score" && claim.Item.Kind == "pilot_task" && claim.Item.JobId is null
            && claim.Execution.Job is null && claim.Execution.Preparation is null && claim.Execution.AccountSetup is null
            && QueueApi.ValidScorePages(claim.Execution.ScorePages);
        if (!valid) throw new InvalidDataException("The queue claim changed the approved execution purpose or snapshot.");
    }

    private async Task HeartbeatAsync(ApiConnection settings, Worker worker, CancellationToken ct, Action cancelled, Action paused, Action lost)
    {
        try
        {
            while (!ct.IsCancellationRequested)
            {
                lock (sync) if (worker.Submitted) return;
                var state = await api.HeartbeatAsync(settings, worker.Claim, ct);
                lock (sync) if (worker.Submitted) return;
                if (state?.CancellationRequestedAt is not null) { cancelled(); await worker.Stop.CancelAsync(); return; }
                if (state?.PauseRequestedAt is not null) { paused(); await worker.Stop.CancelAsync(); return; }
                if (state?.State is not ("preparing" or "ready" or "filling") || state.LeaseExpiresAt is null) throw new InvalidOperationException("Lease lost");
                if (worker.Browser is not null) await worker.Browser.RenewAsync(state.LeaseExpiresAt.Value, ct);
                await Task.Delay(TimeSpan.FromSeconds(10), ct);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
        catch (Exception error) when (error is HttpRequestException { StatusCode: System.Net.HttpStatusCode.Conflict } || IsSubmitted(worker))
        {
            try { if (await BeginSubmittedFinalizationAsync(settings, worker, ct)) return; }
            catch { }
            lost(); worker.Grant.Cancel("A worker lease or browser deadline was lost; all approved workers stopped."); await worker.Stop.CancelAsync();
        }
        catch { lost(); worker.Grant.Cancel("A worker lease or browser deadline was lost; all approved workers stopped."); await worker.Stop.CancelAsync(); }
    }
}
