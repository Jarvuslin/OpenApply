using System.Net;
using JobPilot.Terminal.Pilot;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using static JobPilot.Terminal.Tests.Builders;

namespace JobPilot.Terminal.Tests;

public sealed class PilotEventListenerTests
{
    [Theory]
    [InlineData("""{"type":"question.answered","question":{}}""")]
    [InlineData("""{"type":"state.changed","state":{}}""")]
    [InlineData("""{"type":"promotion.updated","promotion":{"status":"approved"}}""")]
    public void ShouldWake_OnEventsThatUnblockTheNextCycle(string data)
    {
        Assert.True(PilotEventListener.ShouldWake(PilotEventListener.Parse(data)!));
    }

    [Theory]
    [InlineData("""{"type":"promotion.updated","promotion":{"status":"draft"}}""")]
    [InlineData("""{"type":"journal.appended","entry":{}}""")]
    [InlineData("""{"type":"question.created","question":{}}""")]
    public void ShouldWake_IsFalse_ForEverythingElse(string data)
    {
        Assert.False(PilotEventListener.ShouldWake(PilotEventListener.Parse(data)!));
    }

    [Theory]
    [InlineData("")]
    [InlineData("{not json")]
    public void Parse_IgnoresControlFramesAndGarbage(string data)
    {
        Assert.Null(PilotEventListener.Parse(data));
    }

    [Theory]
    [InlineData("""{"type":"state.changed","state":{"running":false}}""", true)]
    [InlineData("""{"type":"state.changed","state":{"running":true}}""", false)]
    [InlineData("""{"type":"state.changed","state":{}}""", false)]
    [InlineData("""{"type":"question.answered","question":{}}""", false)]
    public void IsRemoteStop_OnlyForAStateChangeToStopped(string data, bool expected)
    {
        Assert.Equal(expected, PilotEventListener.IsRemoteStop(PilotEventListener.Parse(data)!));
    }

    [Fact]
    public async Task Listener_Connects_AndWakesTheLoop_OnAnEvent()
    {
        await using var h = await Harness.StartAsync();

        h.Push("event: ping\n\n");
        h.Push("data: {\"type\":\"question.answered\",\"question\":{}}\n\n");

        await TestWait.Until(() => h.Wakes == 1);
        Assert.Equal("Bearer tok", h.Handler.LastRequest?.Headers.Authorization?.ToString());
        Assert.Contains("text/event-stream", h.Handler.LastRequest?.Headers.Accept.ToString());
    }

    [Fact]
    public async Task Listener_Disconnects_WhenThePilotStops()
    {
        await using var h = await Harness.StartAsync();

        h.Store.SetRunning(false);

        await TestWait.Until(() => h.Handler.Stream.Disposed);
    }

    [Fact]
    public async Task Listener_MirrorsARemoteStop_AndWakes()
    {
        await using var h = await Harness.StartAsync();

        h.Push("data: {\"type\":\"state.changed\",\"state\":{\"running\":false}}\n\n");

        await TestWait.Until(() => h.Store.Current is { Running: false });
        await TestWait.Until(() => h.Wakes == 1);
    }

    [Fact]
    public async Task Listener_ReconnectsAtOnce_WithNewSettings()
    {
        await using var h = await Harness.StartAsync();

        h.Store.Save(Settings(apiUrl: "https://next-api", apiToken: "next-token"));

        await TestWait.Until(() => h.Handler.Calls == 2);
        Assert.Equal("https://next-api/api/pilot/events", h.Handler.LastRequest?.RequestUri?.ToString());
        Assert.Equal("Bearer next-token", h.Handler.LastRequest?.Headers.Authorization?.ToString());
    }

    [Fact]
    public async Task Listener_BacksOff_AfterARejectedStream()
    {
        await using var h = await Harness.StartAsync(HttpStatusCode.Unauthorized);

        await Task.Delay(50, TestContext.Current.CancellationToken);

        Assert.Equal(1, h.Handler.Calls);
    }

    /// <summary>A started listener with running settings over a fake SSE stream.</summary>
    private sealed class Harness : IAsyncDisposable
    {
        private readonly TempDir temp = new();
        private readonly PilotEventListener listener;
        private int wakes;

        private Harness(HttpStatusCode status)
        {
            Handler = new FakeSseHandler { Status = status };
            Store = new PilotStore(Path.Combine(temp.Root, "pilot.json"), NullLogger<PilotStore>.Instance);
            var api = new PilotApi(new HttpClient(Handler), NullLogger<PilotApi>.Instance);
            listener = new PilotEventListener(Store, api, () => Interlocked.Increment(ref wakes), NullLogger<PilotEventListener>.Instance);
        }

        public FakeSseHandler Handler { get; }

        public PilotStore Store { get; }

        public int Wakes => Volatile.Read(ref wakes);

        public static async Task<Harness> StartAsync(HttpStatusCode status = HttpStatusCode.OK)
        {
            var harness = new Harness(status);
            harness.Store.Save(Settings());
            await harness.listener.StartAsync(CancellationToken.None);
            await TestWait.Until(() => harness.Handler.Calls > 0);
            return harness;
        }

        public void Push(string frame) => Handler.Stream.Push(frame);

        public async ValueTask DisposeAsync()
        {
            await listener.StopAsync(CancellationToken.None);
            listener.Dispose();
            temp.Dispose();
        }
    }
}
