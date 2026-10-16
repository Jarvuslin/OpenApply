using OpenApply.Terminal.Hosting;
using OpenApply.Terminal.Agent;
using OpenApply.Terminal.Providers;
using Pty.Net;

namespace OpenApply.Terminal.Sessions;

/// <summary>How a session ended. A null exit code means it was stopped on request.</summary>
public readonly record struct SessionExit(string ProviderDisplayName, int? ExitCode)
{
    public bool Requested => ExitCode is null;
}

/// <summary>The one live provider session. Replacing or stopping it disposes its process, so stale exits never land.</summary>
public sealed class TerminalSession : IDisposable
{
    private readonly HostInstall install;
    private readonly ScratchCleaner scratch;
    private readonly Func<PtyOptions, IPtyConnection> spawn;
    private readonly ILogger<TerminalSession> logger;
    private readonly Lock sync = new();
    private readonly AgentRuntimeGate runtimeGate;

    private volatile PtyProcess? current;
    private volatile Provider activeProvider = Provider.Claude;

    public TerminalSession(HostInstall install, ScratchCleaner scratch, ILogger<TerminalSession> logger, AgentRuntimeGate runtimeGate)
        : this(install, scratch, logger, PtyProcess.SpawnWithPtyNet, runtimeGate)
    {
    }

    internal TerminalSession(
        HostInstall install,
        ScratchCleaner scratch,
        ILogger<TerminalSession> logger,
        Func<PtyOptions, IPtyConnection> spawn,
        AgentRuntimeGate? runtimeGate = null)
    {
        this.install = install;
        this.scratch = scratch;
        this.logger = logger;
        this.spawn = spawn;
        this.runtimeGate = runtimeGate ?? new AgentRuntimeGate();
    }

    public event Action<byte[]>? Output;

    /// <summary>Raised just before a new process spawns, so replay buffers reset ahead of its output.</summary>
    public event Action? Starting;

    public event Action<SessionExit>? Exited;

    public bool IsRunning => current is not null;

    /// <summary>The running or last started provider.</summary>
    public Provider ActiveProvider => activeProvider;

    /// <summary>Starts a provider unless it is already running, replacing any other one.</summary>
    /// <exception cref="PtyStartException">The process could not be spawned.</exception>
    public void Start(
        Provider provider,
        int cols,
        int rows,
        string? apiToken = null,
        string? apiUrl = null,
        string? webUrl = null)
    {
        lock (sync)
        {
            var paths = install.RequirePaths();
            if (current is not null && provider == activeProvider)
            {
                logger.LogInformation("{Provider} session already running; Start is a no-op.", provider.Id);
                return;
            }

            if (!runtimeGate.TryAcquireLegacy()) throw new InvalidOperationException("The queue is using the agent. Stop its current work before starting a terminal session.");
            try
            {
                // Before the outgoing session stops, so a failed preparation leaves it alive.
                provider.PrepareWorkspace(paths);

                if (current is not null)
                {
                    logger.LogInformation("Switching terminal provider from {Previous} to {Next}.", activeProvider.Id, provider.Id);
                    current.Dispose();
                    current = null;
                }

                scratch.CleanSessionStart(paths);
                var args = provider.BuildArgs(paths.PluginDir, logger);
                logger.LogInformation(
                    "Starting {Provider}: cwd={Cwd} command={Command} args={Args} cols={Cols} rows={Rows}",
                    provider.DisplayName,
                    paths.WorkingDir,
                    provider.Command,
                    string.Join(" ", args),
                    cols,
                    rows);

                // Skills write scratch files here; a shell-local TEMP would not survive between tool calls.
                var scratchDir = Directory.CreateDirectory(paths.ScratchDir).FullName;
                var env = new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["OPENAPPLY_SKILLS_ROOT"] = paths.SkillsDir,
                    ["OPENAPPLY_WORKSPACE_ROOT"] = paths.WorkingDir,
                    ["OPENAPPLY_TEMP"] = scratchDir,
                    ["OPENAPPLY_API"] = RequestOrEnv(apiUrl, "OPENAPPLY_API", "http://localhost:4101"),
                    ["OPENAPPLY_API_TOKEN"] = RequestOrEnv(apiToken, "OPENAPPLY_API_TOKEN", ""),
                    ["OPENAPPLY_WEB"] = RequestOrEnv(webUrl, "OPENAPPLY_WEB", "http://localhost:4100"),
                };

                Starting?.Invoke();

                var process = new PtyProcess(
                    PtyProcess.BuildOptions(provider.Command, args, paths.WorkingDir, cols, rows, paths.BinDir, env), spawn, logger);
                process.Output += data => Output?.Invoke(data);
                process.Exited += exitCode => OnExited(process, exitCode);
                try
                {
                    process.Start();
                }
                catch (PtyStartException ex)
                {
                    runtimeGate.ReleaseLegacy();
                    logger.LogError(ex, "Failed to start {Provider} PTY.", provider.Id);
                    throw;
                }

                current = process;
                activeProvider = provider;
            }
            catch
            {
                if (current is null) runtimeGate.ReleaseLegacy();
                throw;
            }
        }
    }

    public void Write(byte[] data) => current?.Write(data);

    public void Resize(int cols, int rows) => current?.Resize(cols, rows);

    public void Stop()
    {
        string providerName;
        lock (sync)
        {
            if (current is null)
            {
                return;
            }

            logger.LogInformation("Stopping {Provider} session.", activeProvider.Id);
            current.Dispose();
            current = null;
            runtimeGate.ReleaseLegacy();
            providerName = activeProvider.DisplayName;
        }

        // Raised here because a disposed process never reports its own exit; Pilot waiters still need to hear it.
        Exited?.Invoke(new SessionExit(providerName, ExitCode: null));
    }

    public void Dispose() => Stop();

    private void OnExited(PtyProcess process, int exitCode)
    {
        string providerName;
        lock (sync)
        {
            if (current != process)
            {
                return;
            }

            current = null;
            runtimeGate.ReleaseLegacy();
            providerName = activeProvider.DisplayName;
        }

        Exited?.Invoke(new SessionExit(providerName, exitCode));
    }

    private static string RequestOrEnv(string? value, string envKey, string fallback) =>
        !string.IsNullOrEmpty(value) ? value : Environment.GetEnvironmentVariable(envKey) ?? fallback;
}
