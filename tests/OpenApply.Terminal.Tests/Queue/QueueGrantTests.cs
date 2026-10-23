using System.Text.Json;
using OpenApply.Terminal.Agent;
using OpenApply.Terminal.Queue;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed class QueueGrantTests
{
    internal static string WriteApproval(string root, int allocations = 1, DateTimeOffset? expiry = null)
    {
        var budget = new QueueGrantBudget(10, 10000, 0, 10, 10, 1, 60);
        var file = new QueueGrantFile(1, true, "queue-application", Guid.NewGuid().ToString(), "claude", "sonnet", "test-only:fake-process",
            DateTimeOffset.UtcNow.AddSeconds(-1), expiry ?? DateTimeOffset.UtcNow.AddMinutes(2), true, 0, Math.Min(allocations, 3),
            budget with { MaxRequests = 10 * allocations, MaxTokens = 10000 * allocations, MaxTurns = 10 * allocations, MaxBudgetUsd = allocations },
            Enumerable.Range(0, allocations).Select(_ => new QueueGrantAllocation(Guid.NewGuid().ToString(), Guid.NewGuid().ToString(), budget)).ToArray());
        var path = Path.Combine(root, Guid.NewGuid() + ".json");
        File.WriteAllText(path, JsonSerializer.Serialize(file, AppJsonContext.Default.QueueGrantFile));
        return path;
    }

    internal static QueueClaim Claim(QueueClaimRequest input, int slot = 1)
    {
        var jobId = Guid.NewGuid().ToString();
        return new(new(input.WorkItemId, "application", "preparing", JobId: jobId), Guid.NewGuid().ToString(),
            new("claude", "application", "Synthetic job", "Synthetic instructions", null, Job: new(jobId, Guid.NewGuid().ToString(), "synthetic", "Engineer", "Fixture", "https://jobs.lever.co/fixture/123")),
            new(input.RuntimeId, input.WorkerId, slot, Guid.NewGuid().ToString(), Guid.NewGuid().ToString()), DateTimeOffset.UtcNow.AddSeconds(90), 1);
    }

    [Fact]
    public void PartitionsAreFiniteDistinctAndNeverRecycled()
    {
        using var temp = new TempDir();
        var path = WriteApproval(temp.Root, 3);
        var grant = QueueModelGrant.Read(key => key == QueueModelGrant.EnvironmentKey ? path : null, Path.Combine(temp.Root, "evidence"), DateTimeOffset.UtcNow)!;
        grant.Activate(DateTimeOffset.UtcNow);
        var one = grant.Reserve()!;
        var two = grant.Reserve()!;
        var three = grant.Reserve()!;
        Assert.Null(grant.Reserve());
        var budgets = new[] { grant.Launch(one), grant.Launch(two), grant.Launch(three) };
        Assert.Equal(3, budgets.Select(b => b.LedgerPath).Distinct().Count());
        Assert.Equal(grant.Approval.Budget.MaxRequests, budgets.Sum(b => b.MaxRequests));
        grant.Finish(one);
        Assert.Null(grant.Reserve());
        Assert.Throws<ModelBudgetException>(() => grant.Launch(one));
        Assert.Equal(0, grant.Remaining);
    }

    [Fact]
    public void CopiedApprovalCannotReuseTheRunIdentity()
    {
        using var temp = new TempDir();
        var path = WriteApproval(temp.Root);
        var evidence = Path.Combine(temp.Root, "evidence");
        var first = QueueModelGrant.Read(key => key == QueueModelGrant.EnvironmentKey ? path : null, evidence, DateTimeOffset.UtcNow)!;
        first.Activate(DateTimeOffset.UtcNow);
        var copy = Path.Combine(temp.Root, "copy.json"); File.Copy(path, copy);
        var replay = QueueModelGrant.Read(key => key == QueueModelGrant.EnvironmentKey ? copy : null, evidence, DateTimeOffset.UtcNow)!;
        Assert.Contains("already been used", replay.BlockingReason(DateTimeOffset.UtcNow));
        Assert.Throws<ModelBudgetException>(() => replay.Activate(DateTimeOffset.UtcNow));
    }

    [Fact]
    public void DenialRotatesAndExhaustedDenialIsNotRemaining()
    {
        using var temp = new TempDir();
        var path = WriteApproval(temp.Root, 2);
        var grant = QueueModelGrant.Read(key => key == QueueModelGrant.EnvironmentKey ? path : null, Path.Combine(temp.Root, "evidence"), DateTimeOffset.UtcNow)!;
        grant.Activate(DateTimeOffset.UtcNow);
        var first = grant.Reserve()!; grant.NoClaim(first);
        var second = grant.Reserve()!;
        Assert.NotEqual(first.AllocationId, second.AllocationId);
        grant.Finish(second);
        Assert.Equal(1, grant.Remaining);
    }

    [Fact]
    public async Task ApprovalExpiryCancelsTheSharedRunBeforeItsLongerDuration()
    {
        using var temp = new TempDir();
        var path = WriteApproval(temp.Root, expiry: DateTimeOffset.UtcNow.AddMilliseconds(200));
        var grant = QueueModelGrant.Read(key => key == QueueModelGrant.EnvironmentKey ? path : null, Path.Combine(temp.Root, "evidence"), DateTimeOffset.UtcNow)!;
        grant.Activate(DateTimeOffset.UtcNow);
        await Task.Delay(350, TestContext.Current.CancellationToken);
        Assert.True(grant.Stop.IsCancellationRequested);
        Assert.Null(grant.Reserve());
    }
}
