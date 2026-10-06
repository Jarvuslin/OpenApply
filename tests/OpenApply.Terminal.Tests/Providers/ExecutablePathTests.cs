using OpenApply.Terminal.Providers;
using OpenApply.Terminal.Common;
using Xunit;

namespace OpenApply.Terminal.Tests;

public class ExecutablePathTests
{
    [Fact]
    public void Find_ResolvesAgainstTheSuppliedPath_NotTheProcessEnvironment()
    {
        using var temp = new TempDir();
        var tool = temp.File("mytool.cmd", "@echo off");

        Assert.Equal(tool, ExecutablePath.Find("mytool", temp.Root, ".com;.exe;.bat;.cmd", windows: true));
    }

    [Fact]
    public void Find_ReturnsNull_WhenNoDirectoryOnThePathHasTheCommand()
    {
        using var temp = new TempDir();

        Assert.Null(ExecutablePath.Find("mytool", temp.Root, ".com;.exe;.bat;.cmd", windows: true));
    }

    [Fact]
    public void Find_PrefersARealExecutableOverAShim()
    {
        using var temp = new TempDir();
        temp.File("mytool.cmd", "@echo off");
        var exe = temp.File("mytool.exe", "MZ");

        // Only the .exe spawns without an interpreter, so it wins even when both are present.
        Assert.Equal(exe, ExecutablePath.Find("mytool", temp.Root, ".com;.exe;.bat;.cmd", windows: true));
    }

    [Fact]
    public void Find_IgnoresNpmUnixLauncher_AndSelectsTheWindowsShim()
    {
        using var temp = new TempDir();
        temp.File("codex", "#!/bin/sh");
        var shim = temp.File("codex.cmd", "@echo off");

        Assert.Equal(shim, ExecutablePath.Find("codex", temp.Root, ".exe;.cmd", windows: true));
        Assert.Null(ExecutablePath.Find("codex", temp.Root, ".exe", windows: true));
        Assert.Null(ExecutablePath.Find(Path.Combine(temp.Root, "codex"), temp.Root, ".exe;.cmd", windows: true));
    }

    [Fact]
    public void Find_AcceptsAnExplicitWindowsExtension()
    {
        using var temp = new TempDir();
        var shim = temp.File("codex.cmd", "@echo off");

        Assert.Equal(shim, ExecutablePath.Find("codex.cmd", temp.Root, ".exe;.cmd", windows: true));
    }

    [Fact]
    public void Find_FallsBackToWindowsDefaultExtensions_WhenPathExtIsMissing()
    {
        using var temp = new TempDir();
        // The built-in PATHEXT is uppercase, which a case-sensitive CI filesystem matches literally.
        var tool = temp.File("mytool.CMD", "@echo off");

        Assert.Equal(tool, ExecutablePath.Find("mytool", temp.Root, null, windows: true));
    }

    [Fact]
    public void Find_SearchesEveryPathEntry_AndIgnoresQuotesAndBlanks()
    {
        using var temp = new TempDir();
        var second = Path.Combine(temp.Root, "second");
        var tool = temp.File(Path.Combine("second", "mytool.exe"), "MZ");

        var separator = Path.PathSeparator;
        var path = $"\"{Path.Combine(temp.Root, "missing")}\"{separator}{separator}{second}";

        Assert.Equal(tool, ExecutablePath.Find("mytool", path, ".com;.exe", windows: true));
    }

    [Fact]
    public void Find_AcceptsARootedCommand_WithoutSearchingThePath()
    {
        using var temp = new TempDir();
        var tool = temp.File("mytool.exe", "MZ");

        Assert.Equal(tool, ExecutablePath.Find(tool, null, null, windows: true));
        Assert.Null(ExecutablePath.Find(Path.Combine(temp.Root, "absent.exe"), null, null, windows: true));
    }

    [Fact]
    public void Find_IgnoresWindowsExtensions_OnUnix()
    {
        using var temp = new TempDir();
        temp.File("mytool.exe", "MZ");
        var tool = temp.File("mytool", "#!/bin/sh");

        Assert.Equal(tool, ExecutablePath.Find("mytool", temp.Root, ".com;.exe", windows: false));
    }

    [Theory]
    [InlineData("C:\\tools\\npx.cmd", true)]
    [InlineData("C:\\tools\\npx.BAT", true)]
    [InlineData("C:\\tools\\node.exe", false)]
    public void NeedsShell_IsTrueOnlyForWindowsShims(string path, bool expected)
    {
        if (!OperatingSystem.IsWindows())
        {
            return;
        }

        Assert.Equal(expected, ExecutablePath.NeedsShell(path));
    }
}
