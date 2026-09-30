using System.Text;
using System.Text.RegularExpressions;

namespace JobPilot.Terminal.Pilot;

public enum CycleStatus
{
    Ok,
    Empty,
    Error,
}

/// <summary>How a cycle ended, from its sentinel or the server's record.</summary>
public readonly record struct CycleResult(CycleStatus Status, int SleepSeconds);

/// <summary>
/// Detects the <c>[[JOBPILOT_CYCLE ...]]</c> sentinel in raw PTY output. The TUI redraws and may echo the line, so
/// a rolling tail is rescanned on every feed and each cycle id fires at most once.
/// </summary>
public sealed partial class SentinelParser
{
    // One styled 220x50 repaint frame can be ~8KB; keep several so a repaint never pushes half a match out.
    private const int MaxTailChars = 32768;

    // More than the sentinels that fit in the tail, so an id is never forgotten while its match can still refire.
    private const int MaxSeenIds = 512;

    private readonly StringBuilder tail = new();
    private readonly HashSet<Guid> seen = [];
    private readonly Queue<Guid> seenOrder = new();

    // Matched against a whitespace-free projection of the tail: the TUI wraps the sentinel with a newline+indent
    // anywhere (even mid-GUID), so the fragments only reunite once every space is gone.
    [GeneratedRegex(@"\[\[JOBPILOT_CYCLEcycle=([0-9a-fA-F-]{36})status=(ok|empty|error)sleep=(\d+)\]\]")]
    private static partial Regex SentinelPattern();

    public IReadOnlyList<CycleResult> Feed(ReadOnlySpan<byte> chunk)
    {
        // The sentinel and ANSI framing are ASCII; a UTF-8 split only mangles surrounding non-ASCII text.
        tail.Append(Encoding.UTF8.GetString(chunk));
        if (tail.Length > MaxTailChars)
        {
            tail.Remove(0, tail.Length - MaxTailChars);
        }

        List<CycleResult>? cycles = null;
        foreach (Match match in SentinelPattern().Matches(Condense(tail.ToString())))
        {
            if (!Guid.TryParse(match.Groups[1].ValueSpan, out var cycleId) || !seen.Add(cycleId))
            {
                continue;
            }

            seenOrder.Enqueue(cycleId);
            if (seenOrder.Count > MaxSeenIds)
            {
                seen.Remove(seenOrder.Dequeue());
            }

            (cycles ??= []).Add(new CycleResult(ParseStatus(match.Groups[2].ValueSpan), ParseSleep(match.Groups[3].ValueSpan)));
        }

        return (IReadOnlyList<CycleResult>?)cycles ?? [];
    }

    /// <summary>The server's completion record uses the same status words.</summary>
    internal static CycleStatus ParseStatus(ReadOnlySpan<char> value) => value switch
    {
        "empty" => CycleStatus.Empty,
        "error" => CycleStatus.Error,
        _ => CycleStatus.Ok,
    };

    // The runner clamps; an overflowing number still caps at the ceiling rather than dropping the cycle.
    private static int ParseSleep(ReadOnlySpan<char> value) => int.TryParse(value, out var seconds) ? seconds : int.MaxValue;

    private static string Condense(string input)
    {
        // An escape cut off at the tail edge is dropped; the raw tail replays it whole on the next feed.
        var stripped = Ansi.Strip(input);
        var output = new StringBuilder(stripped.Length);
        foreach (var c in stripped)
        {
            if (!char.IsWhiteSpace(c) && c is not ('\b' or '\a' or '\0'))
            {
                output.Append(c);
            }
        }

        return output.ToString();
    }
}
