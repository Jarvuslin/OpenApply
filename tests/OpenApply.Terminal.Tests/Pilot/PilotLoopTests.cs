using OpenApply.Terminal.Pilot;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using static OpenApply.Terminal.Tests.Builders;

namespace OpenApply.Terminal.Tests;

public sealed class PilotLoopTests
{
    [Fact]
    public async Task ConfiguredPilotOnlySchedulesCommonQueueWork()
    {
        using var temp = new TempDir();
        var store = new PilotStore(Path.Combine(temp.Root, "pilot.json"), NullLogger<PilotStore>.Instance);
        var scheduler = new FakeScheduler();
        using var loop = new PilotLoop(store, scheduler, NullLogger<PilotLoop>.Instance);
        await loop.StartAsync(TestContext.Current.CancellationToken);
        Assert.False(loop.GetStatus().Paired);
        store.Save(Settings());
        await TestWait.Until(() => loop.GetStatus().LastCycleStatus == "queued");
        Assert.Equal(1, scheduler.Schedules);
        Assert.False(loop.GetStatus().Conducting);
        Assert.Equal("queue_scheduler", loop.GetStatus().Mode);
        Assert.Equal(0, loop.GetStatus().ConsecutiveTimeouts);
        store.SetRunning(false);
        loop.Wake();
        await Task.Delay(100, TestContext.Current.CancellationToken);
        Assert.Equal(1, scheduler.Schedules);
        await loop.StopAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task ServerStopPreventsAdmission()
    {
        using var temp = new TempDir();
        var store = new PilotStore(Path.Combine(temp.Root, "pilot.json"), NullLogger<PilotStore>.Instance);
        var scheduler = new FakeScheduler { Running = false };
        using var loop = new PilotLoop(store, scheduler, NullLogger<PilotLoop>.Instance);
        store.Save(Settings());
        await loop.StartAsync(TestContext.Current.CancellationToken);
        await TestWait.Until(() => store.Current is { Running: false });
        Assert.Equal(0, scheduler.Schedules);
        await loop.StopAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task UnreachableApiNeverSchedulesWork()
    {
        using var temp = new TempDir();
        var store = new PilotStore(Path.Combine(temp.Root, "pilot.json"), NullLogger<PilotStore>.Instance);
        var scheduler = new FakeScheduler { Unreachable = true };
        using var loop = new PilotLoop(store, scheduler, NullLogger<PilotLoop>.Instance);
        store.Save(Settings());
        await loop.StartAsync(TestContext.Current.CancellationToken);
        await TestWait.Until(() => scheduler.Probes > 0);
        Assert.Equal(0, scheduler.Schedules);
        await loop.StopAsync(TestContext.Current.CancellationToken);
    }

    private sealed class FakeScheduler : IPilotScheduler
    {
        public int Probes;
        public int Schedules;
        public bool Running = true;
        public bool Unreachable;
        public Task<PilotActivity?> GetActivityAsync(PilotSettings settings, CancellationToken ct)
        {
            Interlocked.Increment(ref Probes);
            return Task.FromResult(Unreachable ? null : Activity(running: Running));
        }
        public Task<int> ScheduleAsync(PilotSettings settings, CancellationToken ct)
        {
            Interlocked.Increment(ref Schedules);
            return Task.FromResult(2);
        }
    }
}
