using System.Net;
using System.Text.Json;
using OpenApply.Terminal.Agent;
using OpenApply.Terminal.Presence;
using OpenApply.Terminal.Queue;
using Xunit;

namespace OpenApply.Terminal.Tests.Presence;

public sealed class RuntimePresenceTests
{
    [Fact]
    public async Task ZeroGrantReportsBlockedWithoutAnyClaimOrProviderRequest()
    {
        var source = new Source();
        var handler = new Handler();
        using var http = new HttpClient(handler);
        var service = new RuntimePresence(http, source);
        await service.PublishAsync(CancellationToken.None);
        Assert.Empty(handler.Calls);
        source.Connection = new("synthetic-presence-token", "http://127.0.0.1:19991", "http://127.0.0.1:19992");
        await service.PublishAsync(CancellationToken.None);
        var call = Assert.Single(handler.Calls);
        Assert.Equal("/api/runtime/presence", call.Path);
        Assert.Equal("Bearer synthetic-presence-token", call.Authorization);
        Assert.Equal("blocked", call.Body.GetProperty("state").GetString());
        Assert.False(call.Body.GetProperty("executionAvailable").GetBoolean());
        Assert.Equal("model_approval_required", call.Body.GetProperty("blockingCode").GetString());
        source.Connection = null;
        await service.PublishAsync(CancellationToken.None);
        Assert.Equal(2, handler.Calls.Count);
        Assert.Equal("stopped", handler.Calls[1].Body.GetProperty("state").GetString());
    }

    [Fact]
    public void QuarantineAndKnownRuntimeErrorsCannotAdvertiseReady()
    {
        var status = new QueueStatus(true, false, null, null, 1, 1, [], new(true, 1, null));
        Assert.Equal("ready", RuntimePresence.Describe("id", status).State);
        Assert.Equal("runtime_error", RuntimePresence.Describe("id", status with { LastError = "failure" }).BlockingCode);
        var worker = new QueueWorkerStatus("w", 1, "i", "e", "b", "quarantined");
        Assert.Equal("browser_unavailable", RuntimePresence.Describe("id", status with { Workers = [worker] }).BlockingCode);
    }

    private sealed class Source : IRuntimePresenceSource
    {
        internal ApiConnection? Connection;
        public RuntimePresenceSnapshot Presence => new(Connection, RuntimePresence.Describe("ef9f2abc-d340-4615-ad17-b30eae14132b", new(true, false, "Missing approval", null, 1, 0, [], new(false, 0, "Missing approval"))));
    }
    private sealed class Handler : HttpMessageHandler
    {
        internal readonly List<(string Path, string? Authorization, JsonElement Body)> Calls = [];
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls.Add((request.RequestUri!.AbsolutePath, request.Headers.Authorization?.ToString(), JsonDocument.Parse(await request.Content!.ReadAsStringAsync(cancellationToken)).RootElement.Clone()));
            return new(HttpStatusCode.OK) { Content = new StringContent("{}") };
        }
    }
}
