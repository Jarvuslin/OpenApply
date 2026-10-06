using System.Text;
using OpenApply.Terminal.Pilot;
using Xunit;

namespace OpenApply.Terminal.Tests;

public class SentinelParserTests
{
    private const string CycleId = "1f2e3d4c-5b6a-7089-90ab-cdef01234567";

    private static byte[] Bytes(string text) => Encoding.UTF8.GetBytes(text);

    private static string Sentinel(string status = "ok", int sleep = 30, string cycle = CycleId) =>
        $"[[OPENAPPLY_CYCLE cycle={cycle} status={status} sleep={sleep}]]";

    [Fact]
    public void Feed_DetectsAWholeSentinel()
    {
        var parser = new SentinelParser();

        var cycles = parser.Feed(Bytes($"working...\n{Sentinel()}\n"));

        var cycle = Assert.Single(cycles);
        Assert.Equal(CycleStatus.Ok, cycle.Status);
        Assert.Equal(30, cycle.SleepSeconds);
    }

    [Fact]
    public void Feed_DetectsASentinelSplitAcrossThreeChunks()
    {
        var parser = new SentinelParser();
        var full = Sentinel(sleep: 120);
        var a = full[..20];
        var b = full[20..45];
        var c = full[45..];

        Assert.Empty(parser.Feed(Bytes(a)));
        Assert.Empty(parser.Feed(Bytes(b)));
        var cycles = parser.Feed(Bytes(c));

        var cycle = Assert.Single(cycles);
        Assert.Equal(120, cycle.SleepSeconds);
    }

    [Fact]
    public void Feed_ToleratesAnsiSequencesInterleavedMidToken()
    {
        var parser = new SentinelParser();
        // A TUI redraw injects color and cursor CSI sequences between the sentinel's characters.
        var noisy = $"[[OPENAPPLY_CYCLE \x1b[0mcycle={CycleId}\x1b[2K status=error\x1b[1m sleep=300]]";

        var cycle = Assert.Single(parser.Feed(Bytes(noisy)));

        Assert.Equal(CycleStatus.Error, cycle.Status);
        Assert.Equal(300, cycle.SleepSeconds);
    }

    [Fact]
    public void Feed_StripsCarriageReturnsFromInPlaceRedraws()
    {
        var parser = new SentinelParser();

        var cycle = Assert.Single(parser.Feed(Bytes($"\r{Sentinel(status: "empty", sleep: 3600)}\r")));

        Assert.Equal(CycleStatus.Empty, cycle.Status);
        Assert.Equal(3600, cycle.SleepSeconds);
    }

    [Fact]
    public void Feed_DetectsASentinelWrappedByTheTui_WithNewlineIndentsMidToken()
    {
        var parser = new SentinelParser();
        // The TUI hard-wraps the line, inserting a newline + indent anywhere, including mid-GUID.
        var wrapped = $"[[OPENAPPLY_CYCLE cycle=1f2e3d4c-5b6a-7089-\n    90ab-cdef01234567 status=ok\n    sleep=30]]";

        var cycle = Assert.Single(parser.Feed(Bytes(wrapped)));

        Assert.Equal(30, cycle.SleepSeconds);
    }

    [Fact]
    public void Feed_DetectsASentinel_WhenAStyledRepaintLargerThanTheOldTailSitsBetweenItsHalves()
    {
        var parser = new SentinelParser();
        var full = Sentinel(sleep: 300);

        // Over 8KB of pure ANSI/whitespace repaint between the halves.
        var styling = string.Concat(Enumerable.Repeat("\x1b[2K\x1b[0m\n", 1200));
        parser.Feed(Bytes(full[..40]));
        parser.Feed(Bytes(styling));
        var cycle = Assert.Single(parser.Feed(Bytes(full[40..])));

        Assert.Equal(300, cycle.SleepSeconds);
    }

    [Fact]
    public void Feed_FiresEachCycleIdOnce_WhenTheLineIsEchoed()
    {
        var parser = new SentinelParser();
        var echoed = $"{Sentinel()}\n{Sentinel()}\n";

        var cycles = parser.Feed(Bytes(echoed));

        Assert.Single(cycles);
    }

    [Fact]
    public void Feed_DoesNotRefireASentinelOnASubsequentFeed()
    {
        var parser = new SentinelParser();
        parser.Feed(Bytes(Sentinel()));

        Assert.Empty(parser.Feed(Bytes("more output\n")));
        Assert.Empty(parser.Feed(Bytes(Sentinel())));
    }

    [Fact]
    public void Feed_FiresDistinctCycleIds()
    {
        var parser = new SentinelParser();
        var other = "abcdef01-2345-6789-abcd-ef0123456789";

        Assert.Single(parser.Feed(Bytes(Sentinel())));
        Assert.Single(parser.Feed(Bytes(Sentinel(cycle: other))));
    }

    [Theory]
    [InlineData("[[OPENAPPLY_CYCLE cycle=not-a-uuid status=ok sleep=30]]")]
    [InlineData("[[OPENAPPLY_CYCLE cycle=1f2e3d4c-5b6a-7089-90ab-cdef01234567 status=bogus sleep=30]]")]
    [InlineData("[[OPENAPPLY_CYCLE cycle=1f2e3d4c-5b6a-7089-90ab-cdef01234567 status=ok sleep=]]")]
    [InlineData("OPENAPPLY_CYCLE cycle=1f2e3d4c-5b6a-7089-90ab-cdef01234567 status=ok sleep=30")]
    [InlineData("just some regular terminal output with numbers 42 and [brackets]")]
    public void Feed_NeverMatchesGarbage(string garbage)
    {
        var parser = new SentinelParser();

        Assert.Empty(parser.Feed(Bytes(garbage)));
    }
}
