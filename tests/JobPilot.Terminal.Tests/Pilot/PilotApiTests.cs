using System.Net;
using JobPilot.Terminal.Pilot;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using static JobPilot.Terminal.Tests.Builders;

namespace JobPilot.Terminal.Tests;

public sealed class PilotApiTests
{
    private const string ActivityJson =
        """{"running":true,"lastActivityAt":"2026-07-19T18:34:43Z","lastCycle":{"cycleId":"1f2e3d4c-5b6a-7089-90ab-cdef01234567","completedAt":"2026-07-19T18:30:00Z","status":"ok","sleepSeconds":300},"activeClaims":2}""";

    private static PilotApi Api(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> respond) =>
        new(new HttpClient(new StubHandler(respond)), NullLogger<PilotApi>.Instance);

    private static Task<HttpResponseMessage> Respond(HttpStatusCode status, string? body = null) =>
        Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body ?? "") });

    [Fact]
    public async Task GetActivity_ParsesTheResponse_WithABearerHeader()
    {
        HttpRequestMessage? seen = null;
        var api = Api((request, _) =>
        {
            seen = request;
            return Respond(HttpStatusCode.OK, ActivityJson);
        });

        var activity = await api.GetActivityAsync(Settings(apiUrl: "https://api.example.test/"), TestContext.Current.CancellationToken);

        Assert.Equal(HttpMethod.Get, seen!.Method);
        Assert.Equal("https://api.example.test/api/pilot/activity", seen.RequestUri!.ToString());
        Assert.Equal("Bearer tok", seen.Headers.Authorization!.ToString());
        Assert.Equal(
            new PilotActivity(
                true,
                new DateTimeOffset(2026, 7, 19, 18, 34, 43, TimeSpan.Zero),
                new CompletedCycle("1f2e3d4c-5b6a-7089-90ab-cdef01234567", new DateTimeOffset(2026, 7, 19, 18, 30, 0, TimeSpan.Zero), "ok", 300)),
            activity);
    }

    [Fact]
    public async Task GetActivity_IsNotNull_WhenTheUserHasNoCycleYet()
    {
        var api = Api((_, _) => Respond(HttpStatusCode.OK, """{"running":false,"lastActivityAt":null,"lastCycle":null}"""));

        var activity = await api.GetActivityAsync(Settings(), TestContext.Current.CancellationToken);

        // A successful probe with no data is not a failure, so the completion fallback stays on.
        Assert.Equal(new PilotActivity(false, null, null), activity);
    }

    [Fact]
    public async Task GetActivity_ReturnsNull_OnARejectionATransportFailureATimeoutOrABadBody()
    {
        var ct = TestContext.Current.CancellationToken;

        Assert.Null(await Api((_, _) => Respond(HttpStatusCode.Unauthorized)).GetActivityAsync(Settings(), ct));
        Assert.Null(await Api((_, _) => throw new HttpRequestException("refused")).GetActivityAsync(Settings(), ct));
        Assert.Null(await Api((_, token) => throw new TaskCanceledException("timed out", null, token)).GetActivityAsync(Settings(), ct));
        Assert.Null(await Api((_, _) => Respond(HttpStatusCode.OK, "{ not json")).GetActivityAsync(Settings(), ct));
    }

    [Fact]
    public async Task Report_PostsTheJournalEntry()
    {
        HttpRequestMessage? seen = null;
        string? body = null;
        var api = Api(async (request, ct) =>
        {
            seen = request;
            body = await request.Content!.ReadAsStringAsync(ct);
            return new HttpResponseMessage(HttpStatusCode.OK);
        });

        await api.ReportAsync(Settings(apiUrl: "https://api.example.test/"), "hello world", TestContext.Current.CancellationToken);

        Assert.Equal(HttpMethod.Post, seen!.Method);
        Assert.Equal("https://api.example.test/api/pilot/journal", seen.RequestUri!.ToString());
        Assert.Equal("Bearer tok", seen.Headers.Authorization!.ToString());
        Assert.Equal("""{"entries":[{"kind":"system","summary":"hello world"}]}""", body);
    }

    [Fact]
    public async Task Report_NeverThrows_OnARejectionOrATransportFailure()
    {
        var ct = TestContext.Current.CancellationToken;

        await Api((_, _) => Respond(HttpStatusCode.InternalServerError)).ReportAsync(Settings(), "boom", ct);
        await Api((_, _) => throw new HttpRequestException("refused")).ReportAsync(Settings(), "unreachable", ct);
    }

    [Fact]
    public async Task Calls_PropagateTheCallersCancellation()
    {
        var api = Api(async (_, ct) =>
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, ct);
            return new HttpResponseMessage(HttpStatusCode.OK);
        });
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => api.GetActivityAsync(Settings(), cts.Token));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => api.ReportAsync(Settings(), "stop", cts.Token));
    }

    private sealed class StubHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> respond)
        : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            respond(request, ct);
    }
}
