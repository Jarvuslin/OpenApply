using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging.Abstractions;
using OpenApply.Terminal.Agent;
using OpenApply.Terminal.Hosting;
using OpenApply.Terminal.Providers;
using OpenApply.Terminal.Queue;
using OpenApply.Terminal.Questions;
using OpenApply.Terminal.Sessions;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed partial class QueuePoolTests
{
    [Fact]
    public async Task ThreeApprovedWorkersOverlapWithDistinctBudgetsAndBrowserOwnership()
    {
        using var test = new Pool();
        await test.Start();
        await TestWait.Until(() => test.Process.Started.Count == 3);
        var active = test.Runtime.Status.Workers!;
        Assert.Equal(3, active.Length);
        Assert.Equal(3, active.Select(worker => worker.BrowserSessionId).Distinct().Count());
        Assert.Equal(3, active.Select(worker => worker.Slot).Distinct().Count());
        Assert.Equal(3, test.Process.Started.Select(request => request.Budget!.LedgerPath).Distinct().Count());
        Assert.Equal(30, test.Process.Started.Sum(request => request.Budget!.MaxRequests));
        Assert.True(test.Gate.QueueOwnsRuntime);
        Assert.False(test.Gate.TryAcquireLegacy());
        test.Process.Complete.TrySetResult(new("completed", UsageKnown: true));
        await TestWait.Until(() => test.Api.Finishes == 3 && !test.Runtime.Status.Running);
        await Task.Delay(300, TestContext.Current.CancellationToken);
        Assert.Equal(3, test.Api.Claims);
        Assert.Equal(3, test.Browser.Closed);
        Assert.Equal(0, test.Runtime.Status.Budget!.RemainingAllocations);
        await test.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task UnknownUsageFromOneWorkerCancelsEverySiblingWithoutRecycling()
    {
        using var test = new Pool();
        test.Process.FirstUnknown = true;
        await test.Start();
        await TestWait.Until(() => test.Process.Started.Count == 3);
        test.Process.Complete.TrySetResult(new("completed"));
        await TestWait.Until(() => test.Api.Finishes == 3 && !test.Runtime.Status.Running);
        Assert.Equal(2, test.Process.Cancelled);
        Assert.Contains("unknown usage", test.Runtime.Status.BlockingReason);
        Assert.Equal(3, test.Api.Claims);
        Assert.Equal(3, test.Browser.Closed);
        await test.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task UnconfirmedCleanupQuarantinesSlotAndKeepsLegacyGate()
    {
        using var test = new Pool();
        test.Browser.FailClose = true;
        await test.Start();
        await TestWait.Until(() => test.Process.Started.Count == 3);
        test.Process.Complete.TrySetResult(new("completed", UsageKnown: true));
        await TestWait.Until(() => test.Api.Finishes == 3);
        Assert.All(test.Runtime.Status.Workers!, worker => Assert.Equal("quarantined", worker.State));
        Assert.True(test.Gate.QueueOwnsRuntime);
        Assert.False(test.Gate.TryAcquireLegacy());
        Assert.Equal(0, test.Runtime.Status.EffectiveCapacity);
        await test.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }

    private sealed class Pool : IDisposable
    {
        private readonly TempDir temp = new();
        private readonly TerminalSession terminal;
        internal readonly Api Api = new();
        internal readonly Agent Process = new();
        internal readonly Browser Browser = new();
        internal readonly AgentRuntimeGate Gate = new();
        internal readonly QueueRuntime Runtime;
        internal readonly string ApprovalPath;
        internal readonly string PluginDir;
        internal readonly AccountApi Account;
        internal Pool(bool preparation = false, bool isolatedFake = false, bool shippedPlugin = false, int allocations = 3, bool account = false, IAccountBrokerApi? accountBroker = null, bool configureGrant = true)
        {
            temp.WriteValidPluginTree();
            PluginDir = Path.Combine(temp.Root, "plugin");
            if (shippedPlugin)
            {
                var source = InstallPaths.Resolve().PluginDir;
                foreach (var file in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
                {
                    var target = Path.Combine(PluginDir, Path.GetRelativePath(source, file));
                    Directory.CreateDirectory(Path.GetDirectoryName(target)!); File.Copy(file, target, true);
                }
            }
            else
            {
                Directory.CreateDirectory(Path.Combine(PluginDir, "settings"));
                Directory.CreateDirectory(Path.Combine(PluginDir, "agents"));
                File.WriteAllText(Path.Combine(PluginDir, "settings", "claude.json"), "{\"model\":\"sonnet\"}");
                File.WriteAllText(Path.Combine(PluginDir, "agents", "worker.md"), "---\nname: worker\nmodel: sonnet\n---\nSynthetic worker");
            }
            var install = new HostInstall(new InstallPaths { WorkingDir = temp.Root, PluginDir = PluginDir });
            terminal = new(install, new ScratchCleaner(install, NullLogger<ScratchCleaner>.Instance), NullLogger<TerminalSession>.Instance, _ => new FakePtyConnection(), Gate);
            ApprovalPath = preparation ? QueuePreparationTests.WriteApproval(temp.Root) : QueueGrantTests.WriteApproval(temp.Root, allocations);
            if (account) ApprovalPath = QueueAccountTests.WriteApproval(temp.Root);
            if (preparation) Api.Preparation = System.Text.Json.JsonSerializer.Deserialize(File.ReadAllText(ApprovalPath), AppJsonContext.Default.QueueGrantFile)!.Allocations[0].Preparation;
            if (account) Api.Account = System.Text.Json.JsonSerializer.Deserialize(File.ReadAllText(ApprovalPath), AppJsonContext.Default.QueueGrantFile)!.Allocations[0].AccountSetup;
            Account = new() { Snapshot = Api.Account!, Phase = "authenticated" };
            Process.PreparationIsolationVerified = isolatedFake;
            var environmentKey = preparation ? QueueModelGrant.PreparationEnvironmentKey : QueueModelGrant.EnvironmentKey;
            if (account) environmentKey = QueueModelGrant.AccountEnvironmentKey;
            Runtime = new(Api, Process, Gate, terminal, NullLogger<QueueRuntime>.Instance, Browser, install, key => configureGrant && key == environmentKey ? ApprovalPath : null, accountBroker ?? Account);
        }
        internal async Task Start()
        {
            var settings = QueueApiTests.Connection;
            await Runtime.ConnectAsync(new(settings.ApiToken, settings.ApiUrl, settings.WebUrl), TestContext.Current.CancellationToken);
            await Runtime.StartAsync(TestContext.Current.CancellationToken);
        }
        public void Dispose() { Runtime.Dispose(); terminal.Dispose(); temp.Dispose(); }
    }

    private sealed class Api : IQueueApi
    {
        internal int Claims;
        internal int Finishes;
        internal int Heartbeats;
        internal readonly List<string> ClaimedIds = [];
        internal Func<string[], QueueOrderItem[]>? Order;
        internal int Observers;
        internal int Verifications;
        internal Func<ApiConnection, Task<string>>? Verify;
        internal string ObserverOwner = "7b40d81a-f5dc-4375-9afc-5c390257f9b6";
        internal bool ObserverActive = true;
        internal string? ViewerToken;
        internal IntakePreparationSnapshot? Preparation;
        internal AccountSetupSnapshot? Account;
        internal Func<QueueClaim, CancellationToken, Task<WorkItem?>>? Heartbeat;
        internal Func<QueueClaim, WorkEvent, CancellationToken, Task>? OnEvent;
        internal Func<QueueClaim, AgentResult, CancellationToken, Task>? OnFinish;
        internal Func<QueueObserver, QueueObserver>? Observe;
        internal readonly ConcurrentBag<AgentResult> Results = [];
        public Task<QueueOrder> OrderedAsync(ApiConnection c, string[] ids, CancellationToken ct) => Task.FromResult(new QueueOrder(DateTimeOffset.UtcNow, Order?.Invoke(ids) ?? ids.Select(id => new QueueOrderItem(id, true, null, null, null)).ToArray()));
        public Task<QueueObserver> ObserverAsync(ApiConnection c, string workItemId, string executionId, string browserSessionId, CancellationToken ct)
        {
            Observers++; ViewerToken = c.ApiToken;
            var result = new QueueObserver(ObserverOwner, workItemId, executionId, browserSessionId, "filling", DateTimeOffset.UtcNow.AddSeconds(30), ObserverActive, executionId);
            if (Account is not null && Finishes > 0) result = result with { State = "needs_user", LeaseExpiresAt = null, Active = false };
            return Task.FromResult(Observe?.Invoke(result) ?? result);
        }
        public Task<string> VerifyAsync(ApiConnection connection, CancellationToken ct)
        {
            Interlocked.Increment(ref Verifications);
            return Verify?.Invoke(connection) ?? Task.FromResult("7b40d81a-f5dc-4375-9afc-5c390257f9b6");
        }
        public Task<AccountSetupSnapshot> AccountSnapshotAsync(ApiConnection connection, string workItemId, CancellationToken ct) => Task.FromResult(Account!);
        public Task<QueueClaimResponse> ClaimAsync(ApiConnection connection, QueueClaimRequest input, CancellationToken ct)
        {
            ClaimedIds.Add(input.WorkItemId);
            var claim = QueueGrantTests.Claim(input, Interlocked.Increment(ref Claims));
            if (Preparation is { } snapshot)
            {
                Assert.Equal(snapshot.SnapshotHash, input.PreparationSnapshotHash);
                claim = claim with { Item = claim.Item with { Kind = "pilot_task", JobId = null }, Execution = claim.Execution with { Intent = "intake_prepare", Job = null, Preparation = new(snapshot, $"prep.{claim.Item.Id}.{claim.LeaseToken}") } };
            }
            if (Account is { } account)
            {
                Assert.True(input.Capabilities.AccountSetup);
                Assert.Equal(account.SnapshotHash, input.AccountSnapshotHash);
                Assert.Null(input.PreparationSnapshotHash);
                claim = claim with { Item = claim.Item with { Kind = "pilot_task", JobId = null }, Execution = claim.Execution with { Intent = "account_setup", Job = null, AccountSetup = new(account, $"account.{claim.Item.Id}.{claim.LeaseToken}") } };
            }
            return Task.FromResult(new QueueClaimResponse(claim, DateTimeOffset.UtcNow, null, null));
        }
        public Task<WorkItem?> HeartbeatAsync(ApiConnection connection, QueueClaim claim, CancellationToken ct) { Interlocked.Increment(ref Heartbeats); return Heartbeat?.Invoke(claim, ct) ?? Task.FromResult<WorkItem?>(claim.Item with { LeaseExpiresAt = DateTimeOffset.UtcNow.AddSeconds(90) }); }
        public Task EventAsync(ApiConnection connection, QueueClaim claim, WorkEvent entry, CancellationToken ct) => OnEvent?.Invoke(claim, entry, ct) ?? Task.CompletedTask;
        public Task FinishAsync(ApiConnection connection, QueueClaim claim, AgentResult result, CancellationToken ct) { Results.Add(result); Interlocked.Increment(ref Finishes); return OnFinish?.Invoke(claim, result, ct) ?? Task.CompletedTask; }
    }

    private sealed class Agent : IAgentProcess
    {
        public bool PreparationIsolationVerified { get; set; }
        internal readonly ConcurrentBag<ApiConnection> Connections = [];
        internal readonly ConcurrentBag<AgentRequest> Started = [];
        internal readonly TaskCompletionSource<AgentResult> Complete = new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal bool FirstUnknown;
        internal int Cancelled;
        internal Func<AgentRequest, Func<AgentEvent, Task>, CancellationToken, Task<AgentResult>>? Execute;
        public async Task<AgentResult> RunAsync(ApiConnection connection, AgentRequest request, Func<AgentEvent, Task> publish, CancellationToken ct)
        {
            Started.Add(request);
            Connections.Add(connection);
            var first = Started.Count == 1;
            try
            {
                if (Execute is not null) return await Execute(request, publish, ct);
                if (FirstUnknown && !first) { await Task.Delay(Timeout.InfiniteTimeSpan, ct); throw new InvalidOperationException(); }
                return await Complete.Task.WaitAsync(ct);
            }
            catch (OperationCanceledException) { Interlocked.Increment(ref Cancelled); throw; }
        }
    }

    private sealed class Browser : IQueueBrowser
    {
        internal int Started;
        internal int Closed;
        internal bool FailClose;
        internal bool FailStartCleanup;
        internal int Frames;
        internal bool FailFrame;
        internal int Renewals;
        internal TaskCompletionSource? CloseRelease;
        internal Func<JsonObject, JsonObject>? OnCommand;
        internal string? WorkspaceRoot;
        public Task<QueueBrowserSession> StartAsync(QueueClaim claim, CancellationToken ct)
        {
            Interlocked.Increment(ref Started);
            return FailStartCleanup
            ? Task.FromException<QueueBrowserSession>(new QuestionBrowserCleanupException())
            : Task.FromResult(new QueueBrowserSession(
            WorkspaceRoot is null ? claim.Ownership!.BrowserSessionId : Path.Combine(WorkspaceRoot, claim.Ownership!.BrowserSessionId), "http://127.0.0.1:14103", (command, _) =>
            {
                if (command["action"]?.GetValue<string>() == "account" && OnCommand is not null) return Task.FromResult(OnCommand(command));
                if (command["action"]?.GetValue<string>() == "park") return Task.FromResult(new JsonObject { ["parked"] = true, ["submissionAllowed"] = false });
                if (command["action"]?.GetValue<string>() == "renew")
                {
                    Interlocked.Increment(ref Renewals);
                    if (Closed > 0) throw new IOException("Synthetic browser already closed");
                }
                if (command["action"]?.GetValue<string>() != "frame") return Task.FromResult(new JsonObject());
                Frames++;
                if (FailFrame) throw new IOException("Synthetic frame failure");
                var frame = new QueueFrame(claim.Item.Id, claim.Ownership.ExecutionId, claim.Ownership.BrowserSessionId, DateTimeOffset.UtcNow, "image/jpeg", "/9j/2Q==", 1280, 720);
                return Task.FromResult((JsonObject)System.Text.Json.JsonSerializer.SerializeToNode(frame, AppJsonContext.Default.QueueFrame)!);
            }, () =>
            {
                Interlocked.Increment(ref Closed);
                return FailClose ? Task.FromException(new IOException("Synthetic cleanup failure")) : CloseRelease?.Task ?? Task.CompletedTask;
            }));
        }
    }

    [Fact]
    public async Task FramesReauthenticateCachedImagesAndNeverControlOrStopTheWorker()
    {
        using var test = new Pool();
        await test.Start();
        await TestWait.Until(() => test.Process.Started.Count == 3);
        var worker = test.Runtime.Status.Workers![0];
        var heartbeats = test.Api.Heartbeats;
        var ct = TestContext.Current.CancellationToken;
        Task<QueueFrame> Read(string token = "viewer-only") => test.Runtime.FrameAsync(worker.BrowserSessionId, worker.WorkItemId, worker.ExecutionId, token, ct);
        await Assert.ThrowsAsync<InvalidOperationException>(() => Read(""));
        Assert.Equal(0, test.Api.Observers);
        var first = await Read();
        Assert.Equal(first, await Read());
        Assert.Equal(2, test.Api.Observers);
        Assert.Equal(1, test.Browser.Frames);
        Assert.Equal("viewer-only", test.Api.ViewerToken);
        test.Api.ObserverOwner = Guid.NewGuid().ToString();
        await Assert.ThrowsAsync<InvalidOperationException>(() => Read());
        test.Api.ObserverOwner = test.Runtime.Status.OwnerId!;
        test.Api.ObserverActive = false;
        await Assert.ThrowsAsync<InvalidOperationException>(() => Read());
        Assert.Equal(1, test.Browser.Frames);
        Assert.Null(test.Runtime.Status.BlockingReason);
        Assert.Equal(3, test.Runtime.Status.Workers!.Length);
        test.Api.ObserverActive = true;
        await Task.Delay(1100, ct);
        test.Browser.FailFrame = true;
        await Assert.ThrowsAsync<IOException>(() => Read());
        Assert.Null(test.Runtime.Status.BlockingReason);
        Assert.Equal(0, test.Api.Finishes);
        Assert.Equal(heartbeats, test.Api.Heartbeats);
        await Assert.ThrowsAsync<InvalidOperationException>(() => test.Runtime.FrameAsync(worker.BrowserSessionId, Guid.NewGuid().ToString(), worker.ExecutionId, "viewer-only", ct));
        test.Process.Complete.TrySetResult(new("completed", UsageKnown: true));
        await TestWait.Until(() => test.Api.Finishes == 3);
        await test.Runtime.StopAsync(ct);
    }

    [Fact]
    public async Task UncertainStartupCleanupRetainsGateWithoutLaunchingAnyProvider()
    {
        using var test = new Pool();
        test.Browser.FailStartCleanup = true;
        await test.Start();
        await TestWait.Until(() => test.Api.Finishes == 1);
        Assert.Single(test.Runtime.Status.Workers!);
        Assert.Equal("quarantined", test.Runtime.Status.Workers![0].State);
        Assert.True(test.Gate.QueueOwnsRuntime);
        Assert.False(test.Gate.TryAcquireLegacy());
        Assert.Empty(test.Process.Started);
        Assert.Equal(1, test.Api.Claims);
        await test.Runtime.StopAsync(TestContext.Current.CancellationToken);
        var evidence = Path.Combine(Path.GetDirectoryName(test.ApprovalPath)!, "queue-model-evidence");
        Assert.Empty(Directory.EnumerateFiles(evidence, "*.launch", SearchOption.AllDirectories));
        Assert.True(File.Exists(test.ApprovalPath + ".used"));
        var replay = QueueModelGrant.Read(key => key == QueueModelGrant.EnvironmentKey ? test.ApprovalPath : null, evidence, DateTimeOffset.UtcNow)!;
        Assert.Contains("already been used", replay.BlockingReason(DateTimeOffset.UtcNow));
    }
}
