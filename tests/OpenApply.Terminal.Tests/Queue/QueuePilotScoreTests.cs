using System.Text.Json;
using OpenApply.Terminal.Agent;
using OpenApply.Terminal.Queue;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed class QueuePilotScoreTests
{
    private static readonly QueueGrantBudget Budget = new(10, 10000, 2, 10, 10, 1, 60);

    private static QueueGrantFile Approval(string purpose, int workers = 1, int allocations = 1) =>
        new(1, true, purpose, Guid.NewGuid().ToString(), "claude", "sonnet", "test-only:pilot",
            DateTimeOffset.UtcNow.AddSeconds(-1), DateTimeOffset.UtcNow.AddMinutes(2), true, 0, workers,
            Budget with { MaxRequests = 10 * allocations, MaxTokens = 10000 * allocations, MaxSubagents = 2 * allocations, MaxTurns = 10 * allocations, MaxBudgetUsd = allocations },
            Enumerable.Range(0, allocations).Select(_ => new QueueGrantAllocation(Guid.NewGuid().ToString(), Guid.NewGuid().ToString(), Budget)).ToArray());

    private static byte[] Bytes(QueueGrantFile file) => JsonSerializer.SerializeToUtf8Bytes(file, AppJsonContext.Default.QueueGrantFile);

    private static QueueModelGrant PilotGrant(TempDir temp)
    {
        var path = Path.Combine(temp.Root, Guid.NewGuid() + ".json");
        File.WriteAllBytes(path, Bytes(Approval("queue-pilot-score")));
        return QueueModelGrant.Read(key => key == QueueModelGrant.PilotEnvironmentKey ? path : null, Path.Combine(temp.Root, "evidence"), DateTimeOffset.UtcNow)!;
    }

    private static readonly QueueScorePage[] Pages =
    [
        new(Guid.NewGuid().ToString(), "https://jobs.lever.co/acme/1"),
        new(Guid.NewGuid().ToString(), "https://careers.example.com/jobs/2"),
    ];

    private static QueueClaim Claim(string workItemId, string kind, string? intent, string? jobId = null, QueueScorePage[]? pages = null)
    {
        QueueJob? job = jobId is null ? null : new(jobId, Guid.NewGuid().ToString(), "synthetic", "Engineer", "Fixture", "https://jobs.lever.co/fixture/123");
        pages ??= intent == "pilot_score" ? Pages : null;
        return new(new(workItemId, kind, "preparing", JobId: jobId), Guid.NewGuid().ToString(),
            new("claude", "assistant", "Score these jobs", "Scoring only", null, Intent: intent, Job: job, ScorePages: pages),
            new(Guid.NewGuid().ToString(), Guid.NewGuid().ToString(), 1, Guid.NewGuid().ToString(), Guid.NewGuid().ToString()), DateTimeOffset.UtcNow.AddSeconds(90), 1);
    }

    [Fact]
    public void PilotApprovalRunsOneWorkerUnderItsOwnKey()
    {
        using var temp = new TempDir();
        var grant = PilotGrant(temp);
        Assert.True(grant.IsPilotScore);
        Assert.False(grant.IsAccountSetup || grant.IsPreparation);
        Assert.Throws<ModelBudgetException>(() => QueueModelGrant.Validate(Bytes(Approval("queue-pilot-score", workers: 2, allocations: 2)), DateTimeOffset.UtcNow, pilot: true));
        Assert.Throws<ModelBudgetException>(() => QueueModelGrant.Validate(Bytes(Approval("queue-pilot-score")), DateTimeOffset.UtcNow));
        Assert.Throws<ModelBudgetException>(() => QueueModelGrant.Validate(Bytes(Approval("queue-application")), DateTimeOffset.UtcNow, pilot: true));
    }

    [Fact]
    public void PilotApprovalIsExclusiveWithOtherApprovals()
    {
        using var temp = new TempDir();
        var path = Path.Combine(temp.Root, "approval.json");
        File.WriteAllBytes(path, Bytes(Approval("queue-pilot-score")));
        Assert.Throws<ModelBudgetException>(() => QueueModelGrant.Read(
            key => key is QueueModelGrant.PilotEnvironmentKey or QueueModelGrant.EnvironmentKey ? path : null,
            Path.Combine(temp.Root, "evidence"), DateTimeOffset.UtcNow));
    }

    [Fact]
    public void PilotGrantClaimsOnlyPilotScoringWithNoJobCapability()
    {
        using var temp = new TempDir();
        var grant = PilotGrant(temp);
        var allocation = grant.Approval.Allocations[0];
        QueueRuntime.ValidateAllocation(Claim(allocation.WorkItemId, "pilot_task", "pilot_score"), allocation, grant);
        Assert.Throws<InvalidDataException>(() => QueueRuntime.ValidateAllocation(Claim(allocation.WorkItemId, "application", null, Guid.NewGuid().ToString()), allocation, grant));
        Assert.Throws<InvalidDataException>(() => QueueRuntime.ValidateAllocation(Claim(allocation.WorkItemId, "pilot_task", "search"), allocation, grant));
        Assert.Throws<InvalidDataException>(() => QueueRuntime.ValidateAllocation(Claim(allocation.WorkItemId, "pilot_task", "pilot_score", Guid.NewGuid().ToString()), allocation, grant));
        Assert.Throws<InvalidDataException>(() => QueueRuntime.ValidateAllocation(Claim(allocation.WorkItemId, "pilot_task", "pilot_score", pages: []), allocation, grant));
    }

    [Fact]
    public void ScoringPagesAreDistinctCredentialFreeHttpsJobs()
    {
        Assert.True(QueueApi.ValidScorePages(Pages));
        Assert.False(QueueApi.ValidScorePages(null));
        Assert.False(QueueApi.ValidScorePages([]));
        Assert.False(QueueApi.ValidScorePages([Pages[0], Pages[0]]));
        Assert.False(QueueApi.ValidScorePages([new(Guid.NewGuid().ToString(), "http://careers.example.com/jobs/2")]));
        Assert.False(QueueApi.ValidScorePages([new(Guid.NewGuid().ToString(), "https://user:pw@careers.example.com/jobs/2")]));
        Assert.False(QueueApi.ValidScorePages([new(Guid.NewGuid().ToString(), "https://careers.example.com:8443/jobs/2")]));
        Assert.False(QueueApi.ValidScorePages([new("not-a-job-id", "https://careers.example.com/jobs/2")]));
        Assert.False(QueueApi.ValidScorePages([.. Enumerable.Range(0, 51).Select(index => new QueueScorePage(Guid.NewGuid().ToString(), $"https://a.example/jobs/{index}"))]));
    }

    [Fact]
    public void ApplicationGrantCannotClaimPilotScoring()
    {
        using var temp = new TempDir();
        var path = QueueGrantTests.WriteApproval(temp.Root);
        var grant = QueueModelGrant.Read(key => key == QueueModelGrant.EnvironmentKey ? path : null, Path.Combine(temp.Root, "evidence"), DateTimeOffset.UtcNow)!;
        var allocation = grant.Approval.Allocations[0];
        Assert.Throws<InvalidDataException>(() => QueueRuntime.ValidateAllocation(Claim(allocation.WorkItemId, "pilot_task", "pilot_score"), allocation, grant));
    }
}
