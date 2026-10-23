using System.Text.Json;
using OpenApply.Terminal.Agent;
using OpenApply.Terminal.Queue;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed class QueuePreparationTests
{
    internal static string WriteApproval(string root)
    {
        var path = QueueGrantTests.WriteApproval(root);
        var approval = JsonSerializer.Deserialize(File.ReadAllText(path), AppJsonContext.Default.QueueGrantFile)!;
        var item = approval.Allocations[0];
        var snapshot = new IntakePreparationSnapshot(1, "intake_prepare", item.WorkItemId, Guid.NewGuid().ToString(), 1,
            Guid.NewGuid().ToString(), Guid.NewGuid().ToString(), "synthetic", "https://jobs.lever.co/synthetic/exact-job", "claude",
            Guid.NewGuid().ToString(), new('a', 64), new('b', 64), new('c', 64), new('d', 64));
        approval = approval with { Purpose = "queue-intake-prepare", Allocations = [item with { Preparation = snapshot }] };
        File.WriteAllText(path, JsonSerializer.Serialize(approval, AppJsonContext.Default.QueueGrantFile));
        return path;
    }

    [Fact]
    public void PreparationGrantIsSeparateExactSingleUseAndCannotMasqueradeAsApplication()
    {
        using var temp = new TempDir();
        var path = WriteApproval(temp.Root);
        var bytes = File.ReadAllBytes(path);
        Assert.Throws<ModelBudgetException>(() => QueueModelGrant.Validate(bytes, DateTimeOffset.UtcNow));
        var value = QueueModelGrant.Validate(bytes, DateTimeOffset.UtcNow, true);
        void Invalid(QueueGrantFile file) => Assert.Throws<ModelBudgetException>(() => QueueModelGrant.Validate(JsonSerializer.SerializeToUtf8Bytes(file, AppJsonContext.Default.QueueGrantFile), DateTimeOffset.UtcNow, true));
        Invalid(value with { MaxConcurrentWorkers = 2 });
        Invalid(value with { Provider = "codex" });
        Invalid(value with { Allocations = [value.Allocations[0] with { Preparation = value.Allocations[0].Preparation! with { WorkItemId = Guid.NewGuid().ToString() } }] });
        Invalid(value with { Allocations = [value.Allocations[0] with { Preparation = value.Allocations[0].Preparation! with { SourceSha256 = "unknown" } }] });
        Assert.Throws<ModelBudgetException>(() => QueueModelGrant.Read(_ => path, Path.Combine(temp.Root, "evidence"), DateTimeOffset.UtcNow));
        var grant = QueueModelGrant.Read(key => key == QueueModelGrant.PreparationEnvironmentKey ? path : null, Path.Combine(temp.Root, "evidence"), DateTimeOffset.UtcNow)!;
        Assert.True(grant.IsPreparation);
        grant.Activate(DateTimeOffset.UtcNow);
        var allocation = grant.Reserve()!;
        Assert.Null(grant.Reserve());
        grant.Launch(allocation);
        grant.Finish(allocation);
        Assert.Throws<ModelBudgetException>(() => grant.Launch(allocation));
    }
}

public sealed partial class QueuePoolTests
{
    [Fact]
    public async Task PreparationIsolationRefusesBeforeApprovalConsumptionOrClaim()
    {
        using var test = new Pool(preparation: true);
        await test.Start();
        await Task.Delay(100, TestContext.Current.CancellationToken);
        Assert.Equal(QueueModelGrant.PreparationIsolationReason, test.Runtime.Status.BlockingReason);
        Assert.Equal(0, test.Api.Claims);
        Assert.Empty(test.Process.Started);
        Assert.False(File.Exists(test.ApprovalPath + ".used"));
        await test.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task IsolatedFakePreparationReceivesOnlyExactCapabilityAndNoApplicationBrowserControls()
    {
        using var test = new Pool(preparation: true, isolatedFake: true);
        await test.Start();
        await TestWait.Until(() => test.Process.Started.Count == 1);
        var request = Assert.Single(test.Process.Started);
        Assert.Equal(test.Api.Preparation, request.Preparation);
        var credentials = Assert.Single(test.Process.Connections);
        Assert.Equal($"prep.{request.WorkItemId}.{request.LeaseToken}", credentials.ApiToken);
        Assert.NotEqual(QueueApiTests.Connection.ApiToken, credentials.ApiToken);
        foreach (var action in new[] { "attach", "prepare", "handoff" })
            await Assert.ThrowsAsync<InvalidOperationException>(() => test.Runtime.ControlAsync(request.Browser!.Workspace, request.Browser.Capability, action, TestContext.Current.CancellationToken));
        Assert.Null(test.Runtime.Status.BlockingReason);
        test.Process.Complete.TrySetResult(new("completed", UsageKnown: true));
        await TestWait.Until(() => test.Api.Finishes == 1);
        Assert.Equal(1, test.Api.Claims);
        await test.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }
}
