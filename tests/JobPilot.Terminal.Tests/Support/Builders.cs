using JobPilot.Terminal.Sessions;
using Microsoft.Extensions.Logging.Abstractions;

namespace JobPilot.Terminal.Tests;

internal static partial class Builders
{
    /// <summary>A started process over the given fake connection.</summary>
    public static PtyProcess StartedPty(FakePtyConnection connection)
    {
        var options = PtyProcess.BuildOptions("claude", [], ".", 80, 24, new Dictionary<string, string>());
        var process = new PtyProcess(options, _ => connection, NullLogger.Instance);
        process.Start();
        return process;
    }
}
