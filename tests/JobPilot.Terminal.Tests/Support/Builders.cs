using JobPilot.Terminal.Pilot;
using JobPilot.Terminal.Sessions;
using Microsoft.Extensions.Logging.Abstractions;

namespace JobPilot.Terminal.Tests;

internal static class Builders
{
    public static PilotSettings Settings(bool running = true, string apiUrl = "https://api", string apiToken = "tok") => new()
    {
        Provider = "claude",
        ApiToken = apiToken,
        ApiUrl = apiUrl,
        WebUrl = "https://web",
        Running = running,
    };

    public static CycleResult Cycle(int sleep, CycleStatus status = CycleStatus.Ok) => new(Guid.NewGuid(), status, sleep);

    public static DateTimeOffset Fresh => DateTimeOffset.UtcNow;

    public static DateTimeOffset Stale => DateTimeOffset.UtcNow - CycleRunner.ActiveWindow - TimeSpan.FromMinutes(5);

    public static PilotActivity Activity(DateTimeOffset? at = null, CompletedCycle? lastCycle = null, bool running = true) =>
        new(running, at, lastCycle);

    public static CompletedCycle Completed(int? sleep, string status = "ok") =>
        new(Guid.NewGuid().ToString(), DateTimeOffset.UtcNow, status, sleep);

    /// <summary>A started process over the given fake connection.</summary>
    public static PtyProcess StartedPty(FakePtyConnection connection)
    {
        var options = PtyProcess.BuildOptions("claude", [], ".", 80, 24, new Dictionary<string, string>());
        var process = new PtyProcess(options, _ => connection, NullLogger.Instance);
        process.Start();
        return process;
    }
}
