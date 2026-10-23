using System.Text;
using OpenApply.Terminal.Providers;
using Pty.Net;

namespace OpenApply.Terminal.Sessions;

internal static class PtyLaunch
{
    internal static void Prepare(PtyOptions options)
    {
        if (!OperatingSystem.IsWindows()) return;

        var executable = ExecutablePath.Find(options.App,
            Variable(options, "PATH"), Variable(options, "PATHEXT"), windows: true)
            ?? throw new FileNotFoundException($"Install {options.App} on this computer, then retry connecting.");
        options.VerbatimCommandLine = true;
        if (!ExecutablePath.NeedsShell(executable))
        {
            options.App = executable;
            options.CommandLine = options.CommandLine.Select(QuoteArgument).ToArray();
            return;
        }

        // A batch launcher parses arguments twice: once for cmd /c and again when it forwards %*.
        var command = EscapeShell(executable) + " " + string.Join(" ", options.CommandLine.Select(arg => EscapeShell(EscapeShell(QuoteArgument(arg)))));
        options.App = Variable(options, "ComSpec") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "cmd.exe");
        options.CommandLine = ["/d", "/s", "/v:off", "/c", "\"" + command + "\""];
    }

    private static string? Variable(PtyOptions options, string name) =>
        options.Environment.FirstOrDefault(item => item.Key.Equals(name, StringComparison.OrdinalIgnoreCase)).Value
        ?? Environment.GetEnvironmentVariable(name);

    // Windows argv parsing doubles trailing backslashes and those immediately before literal quotes.
    private static string QuoteArgument(string argument)
    {
        var quoted = new StringBuilder("\"");
        var slashes = 0;
        foreach (var character in argument)
        {
            if (character == '\\')
            {
                slashes++;
                continue;
            }
            quoted.Append('\\', character == '"' ? slashes * 2 + 1 : slashes);
            quoted.Append(character);
            slashes = 0;
        }
        quoted.Append('\\', slashes * 2);
        return quoted.Append('"').ToString();
    }

    private static string EscapeShell(string value)
    {
        var escaped = new StringBuilder();
        foreach (var character in value)
        {
            if ("()[]%!^\"`<>&|;, *?".Contains(character)) escaped.Append('^');
            escaped.Append(character);
        }
        return escaped.ToString();
    }
}
