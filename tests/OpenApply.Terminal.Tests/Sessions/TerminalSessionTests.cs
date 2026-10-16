using OpenApply.Terminal.Hosting;
using OpenApply.Terminal.Providers;
using OpenApply.Terminal.Sessions;
using Microsoft.Extensions.Logging.Abstractions;
using Pty.Net;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed class TerminalSessionTests : IDisposable
{
    private readonly TempDir temp = new();
    private readonly List<FakePtyConnection> spawned = [];
    private readonly TerminalSession session;
    private PtyOptions? lastOptions;
    private Exception? spawnFailure;

    public TerminalSessionTests()
    {
        temp.WriteValidPluginTree();
        var paths = new InstallPaths { WorkingDir = temp.Root, PluginDir = Path.Combine(temp.Root, "plugin") };
        session = Create(new HostInstall(paths));
    }

    public void Dispose()
    {
        session.Dispose();
        temp.Dispose();
    }

    private FakePtyConnection Live => spawned[^1];

    private TerminalSession Create(HostInstall install) => new(
        install,
        new ScratchCleaner(new HostInstall(paths: null), NullLogger<ScratchCleaner>.Instance),
        NullLogger<TerminalSession>.Instance,
        Spawn);

    private IPtyConnection Spawn(PtyOptions options)
    {
        if (spawnFailure is not null)
        {
            throw spawnFailure;
        }

        lastOptions = options;
        var connection = new FakePtyConnection();
        spawned.Add(connection);
        return connection;
    }

    private void Start(Provider? provider = null) => session.Start(provider ?? Provider.Claude, 80, 24);

    [Fact]
    public void Start_RunsTheRequestedProvider_AndPreparesItsWorkspace()
    {
        Start(Provider.Codex);

        Assert.True(session.IsRunning);
        Assert.Same(Provider.Codex, session.ActiveProvider);
        Assert.Equal("codex", lastOptions!.App);
        Assert.True(File.Exists(Path.Combine(temp.Root, ".agents", "skills", "auto-apply", "SKILL.md")));
    }

    [Fact]
    public void Start_IsANoOp_WhenTheSameProviderIsAlreadyRunning()
    {
        Start(Provider.Claude);
        Start(Provider.Claude);

        Assert.Single(spawned);
    }

    [Fact]
    public void Start_ReplacesAnotherProvider_AndKillsItsProcess()
    {
        Start(Provider.Claude);
        var replaced = Live;

        Start(Provider.Codex);

        Assert.Equal(2, spawned.Count);
        Assert.Equal(1, replaced.KillCalls);
        Assert.Same(Provider.Codex, session.ActiveProvider);
    }

    [Fact]
    public void Start_GivesTheAgentItsEnvironment()
    {
        session.Start(Provider.Claude, 80, 24, apiToken: "tok", apiUrl: "https://api", webUrl: "https://web");

        var env = lastOptions!.Environment;
        Assert.Equal(Path.Combine(temp.Root, "plugin", "skills"), env["OPENAPPLY_SKILLS_ROOT"]);
        Assert.Equal(temp.Root, env["OPENAPPLY_WORKSPACE_ROOT"]);
        Assert.Equal(Path.Combine(temp.Root, ".temp"), env["OPENAPPLY_TEMP"]);
        Assert.True(Directory.Exists(env["OPENAPPLY_TEMP"]));
        Assert.Equal("tok", env["OPENAPPLY_API_TOKEN"]);
        Assert.Equal("https://api", env["OPENAPPLY_API"]);
        Assert.Equal("https://web", env["OPENAPPLY_WEB"]);
        Assert.StartsWith(Path.Combine(temp.Root, "plugin", "bin") + Path.PathSeparator, env["PATH"]);
    }

    [Fact]
    public void Start_LeavesTheSessionStopped_WhenTheProviderCannotSpawn()
    {
        spawnFailure = new FileNotFoundException("claude not on PATH");
        Assert.Throws<PtyStartException>(() => Start());
        Assert.False(session.IsRunning);
    }

    [Fact]
    public void Start_Throws_WhenTheInstallIsIncomplete()
    {
        using var broken = Create(new HostInstall(paths: null, pathsError: "no plugin tree"));

        var ex = Assert.Throws<InvalidOperationException>(() => broken.Start(Provider.Claude, 80, 24));
        Assert.Contains("no plugin tree", ex.Message);
    }

    [Fact]
    public async Task NaturalExit_StopsTheSession_AndShowsTheCrashBanner()
    {
        Start();
        SessionExit? seen = null;
        session.Exited += exit => seen = exit;

        Live.RaiseExit(7);

        await TestWait.Until(() => seen is not null);
        Assert.False(session.IsRunning);
        Assert.False(seen!.Value.Requested);
        Assert.Contains("exited with code 7", TerminalRelay.ExitBanner(seen.Value));
    }

    [Fact]
    public void ExitOfAReplacedProcess_IsIgnored()
    {
        Start(Provider.Claude);
        var replaced = Live;
        Start(Provider.Codex);

        replaced.RaiseExit();

        Assert.True(session.IsRunning);
        Assert.Same(Provider.Codex, session.ActiveProvider);
    }

    [Fact]
    public void Stop_ReportsARequestedExitOnce_WithNoBanner()
    {
        Start();
        var stopped = Live;
        var exits = new List<SessionExit>();
        session.Exited += exits.Add;

        session.Stop();
        stopped.RaiseExit(); // the kill's own exit event must not report again
        session.Stop();

        var exit = Assert.Single(exits);
        Assert.True(exit.Requested);
        Assert.Null(TerminalRelay.ExitBanner(exit));
    }
}
