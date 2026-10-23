using Microsoft.Extensions.Logging.Abstractions;
using OpenApply.Terminal.Agent;
using OpenApply.Terminal.Queue;
using OpenApply.Terminal.Hosting;
using OpenApply.Terminal.Providers;
using OpenApply.Terminal.Sessions;
using Xunit;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace OpenApply.Terminal.Tests;

public sealed class QueueRuntimeTests
{
    [Fact]
    public async Task UnknownClaimOutcomeStopsWithoutRetry()
    {
        using var fixture = new Fixture();
        fixture.Api.FirstPollFails = true;
        await fixture.ConnectAndStart();
        await TestWait.Until(() => fixture.Runtime.Status.LastError is not null);
        await Task.Delay(400, TestContext.Current.CancellationToken);
        Assert.Equal(1, fixture.Api.Claims);
        Assert.False(fixture.Runtime.Status.Running);
        Assert.Equal(0, fixture.Process.Calls);
        await fixture.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task DisconnectInterruptsExactlyOnceAndNeverRetriesTheClaim()
    {
        using var fixture = new Fixture();
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        fixture.Process.Work = async ct => { started.SetResult(); await Task.Delay(Timeout.InfiniteTimeSpan, ct); return new("completed"); };
        await fixture.ConnectAndStart();
        await started.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
        Assert.True(fixture.Runtime.Status.Running);
        fixture.Runtime.Disconnect();
        await TestWait.Until(() => fixture.Api.Finished.Count == 1);
        Assert.Equal("waiting", fixture.Api.Finished[0].Status);
        Assert.Equal(1, fixture.Process.Calls);
        Assert.False(fixture.Runtime.Status.Connected);
        await fixture.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task CancellationFromServerStopsProcessAndAcknowledgesCancelled()
    {
        using var fixture = new Fixture();
        fixture.Api.Cancel = true;
        fixture.Process.Work = async ct => { await Task.Delay(Timeout.InfiniteTimeSpan, ct); return new("completed"); };
        await fixture.ConnectAndStart();
        await TestWait.Until(() => fixture.Api.Finished.Count == 1);
        Assert.Equal("cancelled", fixture.Api.Finished[0].Status);
        await fixture.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task LostLeaseStopsWorkAndCannotRecordCompletion()
    {
        using var fixture = new Fixture();
        fixture.Api.LostLease = true;
        fixture.Process.Work = async ct => { await Task.Delay(Timeout.InfiniteTimeSpan, ct); return new("completed"); };
        await fixture.ConnectAndStart();
        await TestWait.Until(() => fixture.Api.Heartbeats > 0 && !fixture.Runtime.Status.Running);
        Assert.Empty(fixture.Api.Finished);
        await fixture.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task LegacySessionBlocksClaimAndQueueGatePreventsLegacyStartup()
    {
        using var fixture = new Fixture();
        fixture.Terminal.Start(Provider.Claude, 80, 24);
        await fixture.ConnectAndStart();
        Assert.Contains("legacy terminal", fixture.Runtime.Status.BlockingReason);
        Assert.Equal(0, fixture.Api.Claims);
        await fixture.Runtime.StopAsync(TestContext.Current.CancellationToken);
        fixture.Terminal.Stop();
        Assert.True(fixture.Gate.TryAcquireQueue());
        Assert.Throws<InvalidOperationException>(() => fixture.Terminal.Start(Provider.Claude, 80, 24));
        fixture.Gate.ReleaseQueue();
    }

    [Theory]
    [InlineData("{\"maxRequests\":0}")]
    [InlineData("invalid")]
    public async Task DisabledOrInvalidBudgetNeverClaimsOrLaunches(string budget)
    {
        using var fixture = new Fixture(budget);
        await fixture.ConnectAndStart();
        await Task.Delay(100, TestContext.Current.CancellationToken);
        Assert.Contains("disabled", fixture.Runtime.Status.BlockingReason);
        Assert.Equal(0, fixture.Api.Claims);
        Assert.Equal(0, fixture.Process.Calls);
        await fixture.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task StartupNeverConnectsOrClaimsAutomatically()
    {
        using var fixture = new Fixture();
        await fixture.Runtime.StartAsync(TestContext.Current.CancellationToken);
        await Task.Delay(100, TestContext.Current.CancellationToken);
        Assert.False(fixture.Runtime.Status.Connected);
        Assert.Equal(0, fixture.Api.Claims);
        await fixture.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task PauseStopsAndReturnsWaitingWithoutAnotherExecution()
    {
        using var fixture = new Fixture();
        fixture.Api.Pause = true;
        await fixture.ConnectAndStart();
        await TestWait.Until(() => fixture.Api.Finished.Count == 1);
        Assert.Equal("waiting", fixture.Api.Finished[0].Status);
        Assert.Equal(0, fixture.Process.Calls);
        await fixture.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task AlreadyUsedBudgetPreventsAnotherClaim()
    {
        using var temp = new TempDir();
        var ledger = Path.Combine(temp.Root, "used.jsonl");
        File.WriteAllText(ledger, "{}\n");
        using var fixture = new Fixture("""{"maxRequests":10,"maxTokens":1000,"maxSubagents":0,"maxTurns":10,"maxWorkerTurns":10,"maxBudgetUsd":1,"maxSeconds":60}""", ledger);
        await fixture.ConnectAndStart();
        await Task.Delay(100, TestContext.Current.CancellationToken);
        Assert.Contains("already been used", fixture.Runtime.Status.BlockingReason);
        Assert.Equal(0, fixture.Api.Claims);
        await fixture.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }

    private sealed class Fixture : IDisposable
    {
        private readonly TempDir temp = new();
        public readonly FakeApi Api = new();
        public readonly FakeProcess Process = new();
        public readonly AgentRuntimeGate Gate = new();
        public readonly TerminalSession Terminal;
        public readonly QueueRuntime Runtime;
        public Fixture(string? budget = null, string? ledger = null, bool approved = true)
        {
            temp.WriteValidPluginTree();
            temp.File(Path.Combine("plugin", "settings", "claude.json"), "{\"model\":\"sonnet\"}");
            temp.File(Path.Combine("plugin", "agents", "worker.md"), "---\nname: worker\nmodel: sonnet\n---\nSynthetic worker");
            var install = new HostInstall(new InstallPaths { WorkingDir = temp.Root, PluginDir = Path.Combine(temp.Root, "plugin") });
            Terminal = new(install, new ScratchCleaner(install, NullLogger<ScratchCleaner>.Instance), NullLogger<TerminalSession>.Instance, _ => new FakePtyConnection(), Gate);
            var approval = QueueGrantTests.WriteApproval(temp.Root);
            Runtime = new(Api, Process, Gate, Terminal, NullLogger<QueueRuntime>.Instance, new FakeBrowser(temp.Root), install,
                key => key switch { ModelBudget.EnvironmentKey => budget, ModelBudget.LedgerKey => ledger, QueueModelGrant.EnvironmentKey => approved ? approval : null, _ => null });
        }
        public async Task ConnectAndStart()
        {
            var c = QueueApiTests.Connection;
            await Runtime.ConnectAsync(new(c.ApiToken, c.ApiUrl, c.WebUrl), TestContext.Current.CancellationToken);
            await Runtime.StartAsync(TestContext.Current.CancellationToken);
        }
        public void Dispose() { Runtime.Dispose(); Terminal.Dispose(); temp.Dispose(); }
    }

    private sealed class FakeProcess : IAgentProcess
    {
        public bool PreparationIsolationVerified => false;
        public int Calls;
        public Func<CancellationToken, Task<AgentResult>> Work = _ => Task.FromResult(new AgentResult("completed", UsageKnown: true));
        public Task<AgentResult> RunAsync(ApiConnection c, AgentRequest claim, Func<AgentEvent, Task> publish, CancellationToken ct) { Interlocked.Increment(ref Calls); return Work(ct); }
    }

    private sealed class FakeApi : IQueueApi
    {
        public int Claims;
        public int Heartbeats;
        public bool Cancel;
        public bool Pause;
        public bool LostLease;
        public bool FirstPollFails;
        public List<AgentResult> Finished = [];
        public string[] Runnable = [];
        public Task<QueueRunnable> RunnableAsync(ApiConnection c, CancellationToken ct) => Task.FromResult(new QueueRunnable(Runnable, [], [], 1, null));
        public Task<string> VerifyAsync(ApiConnection c, CancellationToken ct) => Task.FromResult("7b40d81a-f5dc-4375-9afc-5c390257f9b6");
        public Task<QueueOrder> OrderedAsync(ApiConnection c, string[] ids, CancellationToken ct) => Task.FromResult(new QueueOrder(DateTimeOffset.UtcNow, ids.Select(id => new QueueOrderItem(id, true, null, null, null)).ToArray()));
        public Task<QueueObserver> ObserverAsync(ApiConnection c, string workItemId, string executionId, string browserSessionId, CancellationToken ct) => throw new NotSupportedException();
        public Task<QueueClaimResponse> ClaimAsync(ApiConnection c, QueueClaimRequest input, CancellationToken ct)
        {
            var count = Interlocked.Increment(ref Claims);
            if (FirstPollFails && count == 1) throw new HttpRequestException("Temporary transport failure");
            var claim = QueueGrantTests.Claim(input);
            return Task.FromResult(new QueueClaimResponse(count == 1 ? claim : null, DateTimeOffset.UtcNow, null, null));
        }
        public Task<WorkItem?> HeartbeatAsync(ApiConnection c, QueueClaim claim, CancellationToken ct)
        {
            Interlocked.Increment(ref Heartbeats);
            if (LostLease) throw new HttpRequestException("lease lost");
            return Task.FromResult<WorkItem?>(claim.Item with { CancellationRequestedAt = Cancel ? DateTimeOffset.UtcNow : null, PauseRequestedAt = Pause ? DateTimeOffset.UtcNow : null, LeaseExpiresAt = DateTimeOffset.UtcNow.AddSeconds(90) });
        }
        public Task EventAsync(ApiConnection c, QueueClaim claim, WorkEvent entry, CancellationToken ct) => Task.CompletedTask;
        public Task FinishAsync(ApiConnection c, QueueClaim claim, AgentResult result, CancellationToken ct) { Finished.Add(result); return Task.CompletedTask; }
    }

    private sealed class FakeBrowser(string root) : IQueueBrowser
    {
        public Task<QueueBrowserSession> StartAsync(QueueClaim claim, CancellationToken ct) => Task.FromResult(new QueueBrowserSession(
            Path.Combine(root, claim.Ownership!.BrowserSessionId), "http://127.0.0.1:14103", (_, _) => Task.FromResult(new JsonObject()), () => Task.CompletedTask));
    }

    [Fact]
    public async Task WithoutApprovalOrRunnableWorkNothingIsClaimed()
    {
        using var fixture = new Fixture(approved: false);
        await fixture.ConnectAndStart();
        await Task.Delay(100, TestContext.Current.CancellationToken);
        Assert.Null(fixture.Runtime.Status.BlockingReason);
        Assert.Equal(0, fixture.Api.Claims);
        Assert.Equal(0, fixture.Process.Calls);
        await fixture.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task RunnableWorkStartsWithoutAnApprovalFile()
    {
        using var fixture = new Fixture(approved: false);
        fixture.Api.Runnable = [Guid.NewGuid().ToString()];
        await fixture.ConnectAndStart();
        await TestWait.Until(() => fixture.Process.Calls == 1 && fixture.Api.Finished.Count == 1);
        Assert.Equal(1, fixture.Api.Claims);
        Assert.Equal("completed", fixture.Api.Finished[0].Status);
        await fixture.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }
}
