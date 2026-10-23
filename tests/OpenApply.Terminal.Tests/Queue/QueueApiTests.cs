using System.Net;
using OpenApply.Terminal.Agent;
using OpenApply.Terminal.Queue;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed class QueueApiTests
{
    [Fact]
    public async Task ConnectionVerificationUsesOnlyReadOnlyAuthentication()
    {
        var calls = 0;
        var api = new QueueApi(new HttpClient(new Handler(request =>
        {
            calls++;
            Assert.Equal(HttpMethod.Get, request.Method);
            Assert.Equal("https://api.example.test/api/auth/me", request.RequestUri!.ToString());
            Assert.Equal("Bearer top-secret", request.Headers.Authorization!.ToString());
            Assert.Null(request.Content);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"id\":\"7b40d81a-f5dc-4375-9afc-5c390257f9b6\"}") });
        })));
        Assert.Equal("7b40d81a-f5dc-4375-9afc-5c390257f9b6", await api.VerifyAsync(Connection, TestContext.Current.CancellationToken));
        Assert.Equal(1, calls);
    }

    [Theory]
    [InlineData("")]
    [InlineData("null")]
    public async Task EmptyClaimCannotPretendToBeAnOwnedLease(string body)
    {
        var api = new QueueApi(new HttpClient(new Handler(_ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body) }))));
        await Assert.ThrowsAnyAsync<Exception>(() => api.ClaimAsync(Connection, ClaimInput, TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task EmptyHeartbeatIsAnErrorAndNeverSilentlyDropsALeasedRun()
    {
        var api = new QueueApi(new HttpClient(new Handler(_ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("") }))));
        await Assert.ThrowsAnyAsync<System.Text.Json.JsonException>(() => api.HeartbeatAsync(Connection, Claim, TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task MalformedNonemptyClaimIsNotTreatedAsNoWork()
    {
        var api = new QueueApi(new HttpClient(new Handler(_ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{") }))));
        await Assert.ThrowsAnyAsync<System.Text.Json.JsonException>(() => api.ClaimAsync(Connection, ClaimInput, TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task LostEventResponseRetriesIdenticalEventWithBearerHeaderOnly()
    {
        List<string> bodies = [];
        var handler = new Handler(async request =>
        {
            Assert.Equal("Bearer top-secret", request.Headers.Authorization!.ToString());
            Assert.DoesNotContain("top-secret", request.RequestUri!.ToString());
            bodies.Add(await request.Content!.ReadAsStringAsync());
            if (bodies.Count == 1) throw new HttpRequestException("connection lost after save");
            return new(HttpStatusCode.OK);
        });
        var api = new QueueApi(new HttpClient(handler));
        await api.EventAsync(Connection, Claim, new("lease", "same-event", "text", "Hello"), TestContext.Current.CancellationToken);
        Assert.Equal(2, bodies.Count);
        Assert.Equal(bodies[0], bodies[1]);
    }

    [Fact]
    public async Task RejectedLeaseIsNeverRetried()
    {
        var calls = 0;
        var api = new QueueApi(new HttpClient(new Handler(_ =>
        {
            calls++;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.Conflict));
        })));
        await Assert.ThrowsAsync<HttpRequestException>(() => api.EventAsync(Connection, Claim, new("lease", "event", "text", "Hello"), TestContext.Current.CancellationToken));
        Assert.Equal(1, calls);
    }

    internal static ApiConnection Connection => new("top-secret", "https://api.example.test", "https://web.example.test");
    internal static QueueClaimRequest ClaimInput => new(Guid.NewGuid().ToString(), Guid.NewGuid().ToString(), Guid.NewGuid().ToString(), Guid.NewGuid().ToString(), new());
    internal static QueueClaim Claim => new(new("work", "application", "preparing", "job"), "lease",
        new("claude", "application", "Hello", "Instructions", null));
    internal static AgentRequest Request => Claim.Request;

    private sealed class Handler(Func<HttpRequestMessage, Task<HttpResponseMessage>> handle) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) => handle(request);
    }
}
