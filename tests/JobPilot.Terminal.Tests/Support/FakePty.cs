using JobPilot.Terminal.Sessions;

namespace JobPilot.Terminal.Tests;

/// <summary>Controllable PTY test double.</summary>
internal sealed class FakePty : IPty
{
    private int generation;

    public event Action<byte[]>? OutputReceived;
    public event Action<PtyExit>? ProcessExited;

    public int CurrentGeneration => generation;

    public List<byte[]> Writes { get; } = [];

    public string? LastCommand { get; private set; }
    public string[]? LastArgs { get; private set; }
    public string? LastWorkingDirectory { get; private set; }
    public IReadOnlyDictionary<string, string>? LastEnvironment { get; private set; }

    public int StartCount { get; private set; }
    public int StopCount { get; private set; }

    public Exception? StartFailure { get; set; }

    public int Start(
        string command,
        string[] args,
        string workingDirectory,
        int cols,
        int rows,
        IReadOnlyDictionary<string, string>? environment = null)
    {
        Stop();
        StartCount++;

        if (StartFailure is not null)
        {
            throw new PtyStartException(command, StartFailure);
        }

        LastCommand = command;
        LastArgs = args;
        LastWorkingDirectory = workingDirectory;
        LastEnvironment = environment;
        return ++generation;
    }

    public void Write(byte[] data) => Writes.Add(data);

    public void Resize(int cols, int rows) { }

    public void Stop() => StopCount++;

    public void Dispose() => Stop();

    public void RaiseExit(int forGeneration, int exitCode = 1) =>
        ProcessExited?.Invoke(new PtyExit(forGeneration, exitCode));

    public void RaiseOutput(byte[] data) => OutputReceived?.Invoke(data);
}
