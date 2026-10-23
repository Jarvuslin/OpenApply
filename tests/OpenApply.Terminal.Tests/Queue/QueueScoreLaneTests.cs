using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging.Abstractions;
using OpenApply.Terminal.Agent;
using OpenApply.Terminal.Hosting;
using OpenApply.Terminal.Queue;
using OpenApply.Terminal.Sessions;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed class QueueScoreLaneTests
{
    private static readonly string ApplicationId = Guid.NewGuid().ToString();
    private static readonly string BatchId = Guid.NewGuid().ToString();

    private sealed class Api : IQueueApi
    {
        public volatile bool ApplicationClaimed;
        public volatile bool BatchClaimed;
        public readonly List<(string Id, AgentResult Result)> Finished = [];
        public Task<QueueRunnable> RunnableAsync(ApiConnection c, CancellationToken ct) => Task.FromResult(new QueueRunnable(
            ApplicationClaimed ? [] : [ApplicationId], [], ApplicationClaimed && !BatchClaimed ? [BatchId] : [], 1, null));
        public Task<string> VerifyAsync(ApiConnection c, CancellationToken ct) => Task.FromResult("7b40d81a-f5dc-4375-9afc-5c390257f9b6");
        public Task<QueueOrder> OrderedAsync(ApiConnection c, string[] ids, CancellationToken ct) => Task.FromResult(new QueueOrder(DateTimeOffset.UtcNow, ids.Select(id => new QueueOrderItem(id, true, null, null, null)).ToArray()));
        public Task<QueueObserver> ObserverAsync(ApiConnection c, string workItemId, string executionId, string browserSessionId, CancellationToken ct) => throw new NotSupportedException();
        public Task<QueueClaimResponse> ClaimAsync(ApiConnection c, QueueClaimRequest input, CancellationToken ct)
        {
            if (input.WorkItemId == ApplicationId)
            {
                ApplicationClaimed = true;
                return Task.FromResult(new QueueClaimResponse(QueueGrantTests.Claim(input), DateTimeOffset.UtcNow, null, null));
            }
            BatchClaimed = true;
            QueueScorePage[] pages = [new(Guid.NewGuid().ToString(), "https://jobs.lever.co/acme/1")];
            var claim = new QueueClaim(new(input.WorkItemId, "pilot_task", "preparing"), Guid.NewGuid().ToString(),
                new("claude", "assistant", "Score these jobs", "Scoring only", null, Intent: "pilot_score", ScorePages: pages),
                new(input.RuntimeId, input.WorkerId, 2, Guid.NewGuid().ToString(), Guid.NewGuid().ToString()), DateTimeOffset.UtcNow.AddSeconds(90), 1);
            return Task.FromResult(new QueueClaimResponse(claim, DateTimeOffset.UtcNow, null, null));
        }
        public Task<WorkItem?> HeartbeatAsync(ApiConnection c, QueueClaim claim, CancellationToken ct) =>
            Task.FromResult<WorkItem?>(claim.Item with { LeaseExpiresAt = DateTimeOffset.UtcNow.AddSeconds(90) });
        public Task EventAsync(ApiConnection c, QueueClaim claim, WorkEvent entry, CancellationToken ct) => Task.CompletedTask;
        public Task FinishAsync(ApiConnection c, QueueClaim claim, AgentResult result, CancellationToken ct)
        {
            lock (Finished) Finished.Add((claim.Item.Id, result));
            return Task.CompletedTask;
        }
    }

    private sealed class Process : IAgentProcess
    {
        public bool PreparationIsolationVerified => false;
        public readonly TaskCompletionSource<AgentResult> Application = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public AgentResult Scoring = new("completed", UsageKnown: true);
        public int Calls;
        public Task<AgentResult> RunAsync(ApiConnection c, AgentRequest request, Func<AgentEvent, Task> publish, CancellationToken ct) =>
            Interlocked.Increment(ref Calls) == 1 ? Application.Task.WaitAsync(ct) : Task.FromResult(Scoring);
    }

    private sealed class Browser(string root) : IQueueBrowser
    {
        public Task<QueueBrowserSession> StartAsync(QueueClaim claim, CancellationToken ct) => Task.FromResult(new QueueBrowserSession(
            Path.Combine(root, claim.Ownership!.BrowserSessionId), "http://127.0.0.1:14103", (_, _) => Task.FromResult(new JsonObject()), () => Task.CompletedTask));
    }

    private sealed class Fixture : IDisposable
    {
        private readonly TempDir temp = new();
        private readonly TerminalSession terminal;
        public readonly Api Api = new();
        public readonly Process Process = new();
        public readonly QueueRuntime Runtime;
        public Fixture()
        {
            temp.WriteValidPluginTree();
            temp.File(Path.Combine("plugin", "settings", "claude.json"), "{\"model\":\"sonnet\"}");
            temp.File(Path.Combine("plugin", "agents", "worker.md"), "---\nname: worker\nmodel: sonnet\n---\nSynthetic worker");
            var install = new HostInstall(new InstallPaths { WorkingDir = temp.Root, PluginDir = Path.Combine(temp.Root, "plugin") });
            var gate = new AgentRuntimeGate();
            terminal = new(install, new ScratchCleaner(install, NullLogger<ScratchCleaner>.Instance), NullLogger<TerminalSession>.Instance, _ => new FakePtyConnection(), gate);
            Runtime = new(Api, Process, gate, terminal, NullLogger<QueueRuntime>.Instance, new Browser(temp.Root), install, _ => null);
        }
        public async Task ConnectAndStart()
        {
            var c = QueueApiTests.Connection;
            await Runtime.ConnectAsync(new(c.ApiToken, c.ApiUrl, c.WebUrl), TestContext.Current.CancellationToken);
            await Runtime.StartAsync(TestContext.Current.CancellationToken);
        }
        public void Dispose() { Runtime.Dispose(); terminal.Dispose(); temp.Dispose(); }
    }

    [Fact]
    public async Task ScoringRunsBesideARunningApplication()
    {
        using var fixture = new Fixture();
        await fixture.ConnectAndStart();
        await TestWait.Until(() => fixture.Api.Finished.Any(row => row.Id == BatchId));
        Assert.Equal(2, fixture.Process.Calls);
        Assert.DoesNotContain(fixture.Api.Finished, row => row.Id == ApplicationId);
        fixture.Process.Application.TrySetResult(new("completed", UsageKnown: true));
        await TestWait.Until(() => fixture.Api.Finished.Any(row => row.Id == ApplicationId));
        Assert.All(fixture.Api.Finished, row => Assert.Equal("completed", row.Result.Status));
        await fixture.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task AFailedScoringRunLeavesTheApplicationRunning()
    {
        using var fixture = new Fixture();
        fixture.Process.Scoring = new("completed");
        await fixture.ConnectAndStart();
        await TestWait.Until(() => fixture.Api.Finished.Any(row => row.Id == BatchId));
        await Task.Delay(300, TestContext.Current.CancellationToken);
        Assert.DoesNotContain(fixture.Api.Finished, row => row.Id == ApplicationId);
        fixture.Process.Application.TrySetResult(new("completed", UsageKnown: true));
        await TestWait.Until(() => fixture.Api.Finished.Any(row => row.Id == ApplicationId));
        Assert.Equal("completed", fixture.Api.Finished.Single(row => row.Id == ApplicationId).Result.Status);
        await fixture.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }
}
