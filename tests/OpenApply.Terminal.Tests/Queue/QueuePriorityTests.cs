using System.Text.Json;
using OpenApply.Terminal.Queue;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed partial class QueuePoolTests
{
    [Fact]
    public async Task ServerPrioritySelectsOnlyStillUnspentExplicitlyApprovedWork()
    {
        using var test = new Pool();
        var grant = JsonSerializer.Deserialize(File.ReadAllText(test.ApprovalPath), AppJsonContext.Default.QueueGrantFile)!;
        test.Api.Order = ids => ids.Reverse().Select(id => new QueueOrderItem(id, true, null, null, DateTimeOffset.UtcNow)).ToArray();
        await test.Start();
        await TestWait.Until(() => test.Process.Started.Count == 3);
        Assert.Equal(grant.Allocations.Reverse().Select(item => item.WorkItemId), test.Api.ClaimedIds);
        test.Process.Complete.TrySetResult(new("completed", UsageKnown: true));
        await TestWait.Until(() => test.Api.Finishes == 3);
        Assert.Equal(3, test.Api.ClaimedIds.Distinct().Count());
        await test.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task ForeignPriorityResponseCannotConsumeApprovalOrClaimAnything()
    {
        using var test = new Pool();
        test.Api.Order = ids => ids.Select(_ => new QueueOrderItem(Guid.NewGuid().ToString(), true, null, null, null)).ToArray();
        await test.Start();
        await TestWait.Until(() => test.Runtime.Status.LastError is not null);
        Assert.Equal(0, test.Api.Claims);
        Assert.False(File.Exists(test.ApprovalPath + ".used"));
        Assert.Empty(test.Process.Started);
        await test.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }
}
