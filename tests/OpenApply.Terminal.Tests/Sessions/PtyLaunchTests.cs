using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using OpenApply.Terminal.Providers;
using OpenApply.Terminal.Sessions;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed class PtyLaunchTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task WindowsLaunch_PreservesArguments_ThroughNativeExecutableOrNpmStyleShim(bool shim)
    {
        if (!OperatingSystem.IsWindows()) return;

        using var temp = new TempDir();
        var probe = temp.File(Path.Combine("tools with spaces", "args.mjs"), """
            import { writeFileSync } from "node:fs";
            writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)));
            """);
        var output = Path.Combine(temp.Root, "result.txt");
        var node = ExecutablePath.Find("node") ?? throw new InvalidOperationException("The Windows launch integration test requires Node.js, as installed by platforms.yml.");
        var command = shim
            ? temp.File(Path.Combine("tools with spaces", "codex.cmd"), $"@echo off\r\nSETLOCAL\r\nSET \"_prog={node}\"\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & \"%_prog%\" \"%~dp0args.mjs\" %*\r\n")
            : node;
        string[] expected = ["plain", "", "résumé with spaces", "model=\"gpt-6-luna\"", @"mcp.args=[""C:\\Program Files\\nodejs\\node.exe""]", @"C:\path with spaces\", "literal&echo|<>^%!()", "%PATH%", "!PATH!", "quoted\"&echo injection"];
        string[] arguments = shim ? [output, .. expected] : [probe, output, .. expected];
        var options = PtyProcess.BuildOptions(command, arguments, temp.Root, 80, 24, null, new Dictionary<string, string>());
        if (shim)
        {
            temp.File(Path.Combine("tools with spaces", "codex"), "#!/bin/sh\nexit 1\n");
            options.App = "codex";
            options.Environment["PATH"] = Path.GetDirectoryName(command) + Path.PathSeparator + options.Environment["PATH"];
        }
        var completion = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
        var log = new StringBuilder();
        using var process = new PtyProcess(options, PtyProcess.SpawnWithPtyNet, NullLogger.Instance);
        process.Output += data => log.Append(Encoding.UTF8.GetString(data));
        process.Exited += code => completion.TrySetResult(code);

        process.Start();
        var exitCode = await completion.Task.WaitAsync(TimeSpan.FromSeconds(15), TestContext.Current.CancellationToken);

        Assert.True(exitCode == 0, log.ToString());
        Assert.True(File.Exists(output), log.ToString());
        using var result = JsonDocument.Parse(File.ReadAllText(output));
        Assert.Equal(expected, result.RootElement.EnumerateArray().Select(value => value.GetString()).ToArray());
    }

    [Fact]
    public void WindowsLaunch_MissingCliHasAnActionableError()
    {
        if (!OperatingSystem.IsWindows()) return;
        using var temp = new TempDir();
        var options = PtyProcess.BuildOptions("openapply-missing-cli", [], temp.Root, 80, 24, null,
            new Dictionary<string, string> { ["PATH"] = temp.Root });

        var error = Assert.Throws<FileNotFoundException>(() => PtyLaunch.Prepare(options));

        Assert.Contains("Install openapply-missing-cli", error.Message);
        Assert.Contains("retry", error.Message);
    }
}
