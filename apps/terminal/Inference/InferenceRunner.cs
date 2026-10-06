using System.ComponentModel;
using System.Diagnostics;

namespace OpenApply.Terminal.Inference;

internal sealed class InferenceRunner
{
    private readonly SemaphoreSlim _gate = new(1, 1);

    internal async Task<T?> RunAsync<T>(Func<CancellationToken, Task<T>> run, TimeSpan limit, CancellationToken ct) where T : class
    {
        if (!await _gate.WaitAsync(0, ct)) return null;
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(limit);
            return await run(timeout.Token);
        }
        finally { _gate.Release(); }
    }

    internal static async Task<string> RunProcessAsync(ProcessStartInfo start, string prompt, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        using var process = new Process { StartInfo = start };
        using var reads = CancellationTokenSource.CreateLinkedTokenSource(ct);
        Task<string>? stdout = null;
        Task<string>? stderr = null;
        var started = false;
        try
        {
            started = process.Start();
            stdout = process.StandardOutput.ReadToEndAsync(reads.Token);
            stderr = process.StandardError.ReadToEndAsync(reads.Token);
            await process.StandardInput.WriteAsync(prompt.AsMemory(), ct);
            // Close must not synchronously flush a buffered prompt into a stalled CLI.
            await process.StandardInput.FlushAsync(ct);
            process.StandardInput.Close();
            await process.WaitForExitAsync(ct);
            await Task.WhenAll(stdout, stderr);
            if (process.ExitCode != 0) throw new InvalidOperationException("The CLI did not complete successfully.");
            return await stdout;
        }
        finally
        {
            reads.Cancel();
            if (started)
            {
                try
                {
                    if (!process.HasExited) process.Kill(entireProcessTree: true);
                    await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5));
                }
                catch (Exception ex) when (ex is InvalidOperationException or Win32Exception or TimeoutException) { }
            }
            if (stdout is not null && stderr is not null)
            {
                try { await Task.WhenAll(stdout, stderr).WaitAsync(TimeSpan.FromSeconds(1)); }
                catch (Exception ex) when (ex is OperationCanceledException or IOException or ObjectDisposedException or TimeoutException) { }
            }
        }
    }
}
