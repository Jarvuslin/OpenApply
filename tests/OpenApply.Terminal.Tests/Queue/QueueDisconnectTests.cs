using Microsoft.AspNetCore.Http;
using OpenApply.Terminal.Queue;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed partial class QueuePoolTests
{
    [Fact]
    public async Task UnauthenticatedAndForeignDisconnectCannotStopActiveWorkers()
    {
        using var test = new Pool();
        await test.Start();
        await TestWait.Until(() => test.Process.Started.Count == 3);
        var current = test.Runtime.Status;
        var request = new DefaultHttpContext().Request;
        request.QueryString = new($"?expectedOwnerId={current.OwnerId}&connectionId={current.ConnectionId}");
        var verifications = test.Api.Verifications;
        var result = await QueueEndpoints.TryDisconnectAsync(request, test.Runtime, TestContext.Current.CancellationToken);
        Assert.Equal(401, Assert.IsAssignableFrom<IStatusCodeHttpResult>(result).StatusCode);
        Assert.Equal(verifications, test.Api.Verifications);
        test.Api.Verify = _ => Task.FromResult(Guid.NewGuid().ToString());
        request.Headers.Authorization = "Bearer wrong-owner-token";
        result = await QueueEndpoints.TryDisconnectAsync(request, test.Runtime, TestContext.Current.CancellationToken);
        Assert.Equal(409, Assert.IsAssignableFrom<IStatusCodeHttpResult>(result).StatusCode);
        Assert.Equal(current.ConnectionId, test.Runtime.Status.ConnectionId);
        Assert.Equal(3, test.Runtime.Status.Workers!.Length);
        Assert.Equal(0, test.Process.Cancelled);
        Assert.Null(test.Runtime.Status.BlockingReason);
        test.Api.Verify = _ => Task.FromResult(current.OwnerId!);
        request.Headers.Authorization = "Bearer current-owner-token";
        Assert.Null(await QueueEndpoints.TryDisconnectAsync(request, test.Runtime, TestContext.Current.CancellationToken));
        await TestWait.Until(() => test.Api.Finishes == 3);
        Assert.False(test.Runtime.Status.Connected);
        Assert.Null(test.Runtime.Status.OwnerId);
        Assert.Null(test.Runtime.Status.ConnectionId);
        Assert.Equal(3, test.Process.Cancelled);
        await test.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task DisconnectVerificationCannotRaceANewerConnection(bool sameAccount)
    {
        using var test = new Pool();
        var ct = TestContext.Current.CancellationToken;
        var settings = QueueApiTests.Connection;
        var ownerA = Guid.NewGuid().ToString();
        var ownerB = sameAccount ? ownerA : Guid.NewGuid().ToString();
        test.Api.Verify = _ => Task.FromResult(ownerA);
        await test.Runtime.ConnectAsync(new(settings.ApiToken, settings.ApiUrl, settings.WebUrl), ct);
        var before = test.Runtime.Status;
        var verifying = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var verified = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        test.Api.Verify = connection =>
        {
            if (connection.ApiToken == "delayed-old-disconnect") { verifying.TrySetResult(); return verified.Task; }
            return Task.FromResult(ownerB);
        };
        var oldDisconnect = test.Runtime.DisconnectAuthenticatedAsync(ownerA, before.ConnectionId!, "delayed-old-disconnect", ct);
        await verifying.Task.WaitAsync(TimeSpan.FromSeconds(3), ct);
        await test.Runtime.ConnectAsync(new(settings.ApiToken, settings.ApiUrl, settings.WebUrl), ct);
        var after = test.Runtime.Status;
        Assert.NotEqual(before.ConnectionId, after.ConnectionId);
        Assert.Equal(ownerB, after.OwnerId);
        await test.Runtime.StartAsync(ct);
        await TestWait.Until(() => test.Process.Started.Count == 3);
        verified.TrySetResult(ownerA);
        await Assert.ThrowsAsync<InvalidOperationException>(() => oldDisconnect);
        await Assert.ThrowsAsync<InvalidOperationException>(() => test.Runtime.DisconnectAuthenticatedAsync(ownerA, before.ConnectionId!, "stale-tab", ct));
        Assert.Equal(after.ConnectionId, test.Runtime.Status.ConnectionId);
        Assert.Equal(ownerB, test.Runtime.Status.OwnerId);
        Assert.Equal(3, test.Runtime.Status.Workers!.Length);
        Assert.Equal(0, test.Process.Cancelled);
        Assert.Null(test.Runtime.Status.BlockingReason);
        test.Process.Complete.TrySetResult(new("completed", UsageKnown: true));
        await TestWait.Until(() => test.Api.Finishes == 3);
        await test.Runtime.StopAsync(ct);
    }
}
