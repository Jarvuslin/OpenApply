using System.Net;
using OpenApply.Terminal.Agent;
using OpenApply.Terminal.Queue;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed partial class QueuePoolTests
{
    private static HttpRequestException EndedLease() => new("Synthetic ended lease", null, HttpStatusCode.Conflict);
    private static QueueObserver Submitted(QueueObserver observation) => observation with { State = "submitted", Active = false, LeaseExpiresAt = null };

    [Fact]
    public async Task RecordedApplicationClosesBrowserBeforeAllowingActualHandbackAndUsageToFinish()
    {
        using var test = new Pool(allocations: 1);
        var events = 0;
        var handback = false;
        test.Api.OnEvent = (_, _, _) => { events++; throw EndedLease(); };
        test.Api.Observe = Submitted;
        test.Process.Execute = async (_, publish, ct) =>
        {
            await publish(new("text", "Application recorded; completing bookkeeping."));
            await test.Process.Complete.Task.WaitAsync(ct);
            handback = true;
            await publish(new("text", "Actual worker handback validated."));
            return new("completed", UsageKnown: true);
        };
        await test.Start();
        await TestWait.Until(() => test.Runtime.Status.Workers!.SingleOrDefault()?.State == "finishing");
        var worker = Assert.Single(test.Runtime.Status.Workers!);
        var request = Assert.Single(test.Process.Started);
        Assert.Equal(1, test.Browser.Closed);
        Assert.False(handback);
        Assert.Equal(0, test.Process.Cancelled);
        Assert.Null(test.Runtime.Status.BlockingReason);
        await Assert.ThrowsAsync<InvalidOperationException>(() => test.Runtime.ControlAsync(worker.BrowserSessionId, request.Browser!.Capability, "attach", TestContext.Current.CancellationToken));
        await Assert.ThrowsAsync<InvalidOperationException>(() => test.Runtime.FrameAsync(worker.BrowserSessionId, worker.WorkItemId, worker.ExecutionId, "viewer", TestContext.Current.CancellationToken));
        test.Process.Complete.TrySetResult(new("completed", UsageKnown: true));
        await TestWait.Until(() => !test.Runtime.Status.Running);
        Assert.True(handback);
        Assert.Empty(test.Api.Results);
        Assert.Null(test.Runtime.Status.LastError);
        Assert.Equal(1, events);
        Assert.Equal(1, test.Api.Observers);
        Assert.Equal(1, test.Browser.Closed);
        Assert.Equal(1, test.Api.Claims);
        Assert.Equal(0, test.Process.Cancelled);
        await test.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task HeartbeatConflictAfterRecordingStopsRenewalWithoutCancellingFinalization()
    {
        using var test = new Pool(allocations: 1);
        var recorded = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        test.Api.Heartbeat = async (_, ct) => { await recorded.Task.WaitAsync(ct); throw EndedLease(); };
        test.Api.Observe = Submitted;
        await test.Start();
        await TestWait.Until(() => test.Process.Started.Count == 1);
        recorded.SetResult();
        await TestWait.Until(() => test.Runtime.Status.Workers!.SingleOrDefault()?.State == "finishing");
        Assert.Equal(1, test.Browser.Closed);
        Assert.Equal(1, test.Api.Heartbeats);
        Assert.Equal(0, test.Process.Cancelled);
        test.Process.Complete.TrySetResult(new("completed", UsageKnown: true));
        await TestWait.Until(() => !test.Runtime.Status.Running);
        Assert.Empty(test.Api.Results);
        Assert.Null(test.Runtime.Status.LastError);
        Assert.Equal(1, test.Api.Heartbeats);
        Assert.Equal(1, test.Browser.Closed);
        await test.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task InFlightHeartbeatCannotRenewTheBrowserAfterEventDetectsRecording()
    {
        using var test = new Pool(allocations: 1);
        var releaseHeartbeat = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var heartbeatReturned = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        test.Api.Heartbeat = async (claim, ct) =>
        {
            await releaseHeartbeat.Task.WaitAsync(ct);
            heartbeatReturned.SetResult();
            return claim.Item with { LeaseExpiresAt = DateTimeOffset.UtcNow.AddSeconds(90) };
        };
        test.Api.OnEvent = (_, _, _) => throw EndedLease();
        test.Api.Observe = Submitted;
        test.Process.Execute = async (_, publish, ct) =>
        {
            await publish(new("text", "Recorded while heartbeat response was in flight."));
            return await test.Process.Complete.Task.WaitAsync(ct);
        };
        await test.Start();
        await TestWait.Until(() => test.Runtime.Status.Workers!.SingleOrDefault()?.State == "finishing");
        releaseHeartbeat.SetResult();
        await heartbeatReturned.Task.WaitAsync(TestContext.Current.CancellationToken);
        await Task.Delay(50, TestContext.Current.CancellationToken);
        Assert.Equal(0, test.Browser.Renewals);
        Assert.Equal(0, test.Process.Cancelled);
        Assert.Null(test.Runtime.Status.BlockingReason);
        test.Process.Complete.TrySetResult(new("completed", UsageKnown: true));
        await TestWait.Until(() => !test.Runtime.Status.Running);
        Assert.Empty(test.Api.Results);
        Assert.Equal(1, test.Browser.Closed);
        await test.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task EventDuringHeartbeatFinalizationWaitsForTheSameConfirmedBrowserClose()
    {
        using var test = new Pool(allocations: 1);
        var recorded = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var emit = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var publishing = false;
        var returned = false;
        test.Browser.CloseRelease = new(TaskCreationOptions.RunContinuationsAsynchronously);
        test.Api.Heartbeat = async (_, ct) => { await recorded.Task.WaitAsync(ct); throw EndedLease(); };
        test.Api.Observe = Submitted;
        test.Process.Execute = async (_, publish, ct) =>
        {
            await emit.Task.WaitAsync(ct);
            publishing = true;
            await publish(new("text", "Finish only after the recorded application's browser closes."));
            returned = true;
            return await test.Process.Complete.Task.WaitAsync(ct);
        };
        await test.Start();
        await TestWait.Until(() => test.Process.Started.Count == 1);
        recorded.SetResult();
        await TestWait.Until(() => test.Runtime.Status.Workers!.SingleOrDefault()?.State == "finishing");
        emit.SetResult();
        await TestWait.Until(() => publishing);
        await Task.Delay(50, TestContext.Current.CancellationToken);
        Assert.False(returned);
        Assert.Equal(1, test.Browser.Closed);
        test.Browser.CloseRelease.SetResult();
        await TestWait.Until(() => returned);
        test.Process.Complete.TrySetResult(new("completed", UsageKnown: true));
        await TestWait.Until(() => !test.Runtime.Status.Running);
        Assert.Equal(1, test.Browser.Closed);
        Assert.Empty(test.Api.Results);
        await test.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }

    [Theory]
    [InlineData("needs_user")]
    [InlineData("failed")]
    [InlineData("paused")]
    [InlineData("active")]
    [InlineData("owner")]
    [InlineData("work")]
    [InlineData("execution")]
    [InlineData("currentExecution")]
    [InlineData("missingCurrentExecution")]
    [InlineData("browser")]
    [InlineData("lease")]
    public async Task OtherConflictsOrMismatchedCanonicalOwnershipNeverPermitFinalization(string invalid)
    {
        using var test = new Pool(allocations: 1);
        var passedConflict = false;
        test.Api.OnEvent = (_, _, _) => throw EndedLease();
        test.Api.Observe = value => invalid switch
        {
            "active" => Submitted(value) with { Active = true },
            "owner" => Submitted(value) with { OwnerId = Guid.NewGuid().ToString() },
            "work" => Submitted(value) with { WorkItemId = Guid.NewGuid().ToString() },
            "execution" => Submitted(value) with { ExecutionId = Guid.NewGuid().ToString() },
            "currentExecution" => Submitted(value) with { CurrentExecutionId = Guid.NewGuid().ToString() },
            "missingCurrentExecution" => Submitted(value) with { CurrentExecutionId = null },
            "browser" => Submitted(value) with { BrowserSessionId = Guid.NewGuid().ToString() },
            "lease" => Submitted(value) with { LeaseExpiresAt = DateTimeOffset.UtcNow.AddSeconds(30) },
            _ => Submitted(value) with { State = invalid },
        };
        test.Process.Execute = async (_, publish, _) =>
        {
            await publish(new("text", "Synthetic event after lease conflict."));
            passedConflict = true;
            return new("completed", UsageKnown: true);
        };
        await test.Start();
        await TestWait.Until(() => test.Api.Finishes == 1 && !test.Runtime.Status.Running);
        Assert.False(passedConflict);
        Assert.Equal("waiting", Assert.Single(test.Api.Results).Status);
        Assert.Equal(1, test.Api.Claims);
        Assert.Equal(1, test.Browser.Closed);
        Assert.Contains("failed", test.Runtime.Status.BlockingReason);
        await test.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task DisconnectStillCancelsSubmittedFinalizationWithoutAnotherClaim()
    {
        using var test = new Pool(allocations: 1);
        test.Api.OnEvent = (_, _, _) => throw EndedLease();
        test.Api.Observe = Submitted;
        test.Process.Execute = async (_, publish, ct) =>
        {
            await publish(new("text", "Recorded; final response pending."));
            return await test.Process.Complete.Task.WaitAsync(ct);
        };
        await test.Start();
        await TestWait.Until(() => test.Runtime.Status.Workers!.SingleOrDefault()?.State == "finishing");
        test.Runtime.Disconnect();
        await TestWait.Until(() => test.Process.Cancelled == 1 && !test.Runtime.Status.Running);
        Assert.Equal(1, test.Browser.Closed);
        Assert.Equal(1, test.Api.Claims);
        await test.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task FinalizationStopsAtItsOwnOrTheEarlierOriginalGrantDeadline(bool originalDeadline)
    {
        using var test = new Pool(allocations: 1);
        if (originalDeadline)
        {
            var approval = System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(test.ApprovalPath))!;
            approval["expiresAt"] = DateTimeOffset.UtcNow.AddSeconds(2);
            File.WriteAllText(test.ApprovalPath, approval.ToJsonString());
        }
        test.Api.OnEvent = (_, _, _) => throw EndedLease();
        test.Api.Observe = Submitted;
        test.Process.Execute = async (_, publish, ct) =>
        {
            await publish(new("text", "Recorded; no provider completion follows."));
            return await test.Process.Complete.Task.WaitAsync(ct);
        };
        await test.Start();
        await TestWait.Until(() => test.Runtime.Status.Workers!.SingleOrDefault()?.State == "finishing");
        var deadline = originalDeadline ? TimeSpan.FromSeconds(3) : TimeSpan.FromSeconds(31);
        var expired = DateTimeOffset.UtcNow + deadline;
        while (test.Runtime.Status.Running && DateTimeOffset.UtcNow < expired)
            await Task.Delay(20, TestContext.Current.CancellationToken);
        Assert.False(test.Runtime.Status.Running);
        Assert.Equal(1, test.Process.Cancelled);
        Assert.Equal(1, test.Api.Claims);
        Assert.Equal(1, test.Browser.Closed);
        Assert.Empty(test.Api.Results);
        Assert.NotNull(test.Runtime.Status.BlockingReason);
        await test.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task FinishConflictReconcilesOnlyTheExactCurrentSubmittedExecution(bool historical)
    {
        using var test = new Pool(allocations: 1);
        test.Api.OnFinish = (_, _, _) => throw EndedLease();
        test.Api.Observe = value => Submitted(value) with { CurrentExecutionId = historical ? Guid.NewGuid().ToString() : value.ExecutionId };
        await test.Start();
        await TestWait.Until(() => test.Process.Started.Count == 1);
        test.Process.Complete.TrySetResult(new("completed", UsageKnown: true));
        await TestWait.Until(() => test.Api.Finishes == 1 && !test.Runtime.Status.Running);
        Assert.Equal(historical, test.Runtime.Status.LastError is not null);
        Assert.Equal(1, test.Api.Observers);
        Assert.Equal(1, test.Api.Claims);
        Assert.Equal(1, test.Browser.Closed);
        await test.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }
}
