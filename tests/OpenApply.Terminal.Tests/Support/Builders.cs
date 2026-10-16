using OpenApply.Terminal.Pilot;
using OpenApply.Terminal.Providers;
using OpenApply.Terminal.Sessions;
using Microsoft.Extensions.Logging.Abstractions;

namespace OpenApply.Terminal.Tests;

internal static class Builders
{
    public static PilotSettings Settings(bool running = true, string apiUrl = "https://api", string apiToken = "tok") => new()
    {
        Provider = Provider.Claude,
        ApiToken = apiToken,
        ApiUrl = apiUrl,
        WebUrl = "https://web",
        Running = running,
    };

    public static PilotActivity Activity(DateTimeOffset? at = null, CompletedCycle? lastCycle = null, bool running = true) =>
        new(running, at, lastCycle);

    /// <summary>A started process over the given fake connection.</summary>
    public static PtyProcess StartedPty(FakePtyConnection connection)
    {
        var options = PtyProcess.BuildOptions("claude", [], ".", 80, 24, binDir: null, new Dictionary<string, string>());
        var process = new PtyProcess(options, _ => connection, NullLogger.Instance);
        process.Start();
        return process;
    }
}
