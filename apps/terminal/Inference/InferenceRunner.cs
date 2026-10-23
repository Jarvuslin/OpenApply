using System.ComponentModel;
using System.Diagnostics;
using System.Text;
using OpenApply.Terminal.Agent;

namespace OpenApply.Terminal.Inference;

internal sealed class InferenceRunner
{
    internal const int MaxOutputCharacters = 2_000_000;
    internal const int MaxErrorCharacters = 64_000;
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
        // Provider pipes are UTF-8 even when Windows inherits a legacy console codepage.
        var utf8 = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);
        start.StandardInputEncoding = utf8;
        start.StandardOutputEncoding = utf8;
        start.StandardErrorEncoding = utf8;
        using var process = new Process { StartInfo = start };
        using var reads = CancellationTokenSource.CreateLinkedTokenSource(ct);
        Task<string>? stdout = null;
        Task<string>? stderr = null;
        IDisposable? lifetime = null;
        var overflow = 0;
        var started = false;
        try
        {
            started = process.Start();
            lifetime = AgentProcessLifetime.Attach(process);
            void Overflow() { Interlocked.Exchange(ref overflow, 1); reads.Cancel(); }
            stdout = ReadBoundedAsync(process.StandardOutput, MaxOutputCharacters, true, Overflow, reads.Token);
            stderr = ReadBoundedAsync(process.StandardError, MaxErrorCharacters, false, Overflow, reads.Token);
            await process.StandardInput.WriteAsync(prompt.AsMemory(), reads.Token);
            // Close must not synchronously flush a buffered prompt into a stalled CLI.
            await process.StandardInput.FlushAsync(reads.Token);
            process.StandardInput.Close();
            await process.WaitForExitAsync(reads.Token);
            await Task.WhenAll(stdout, stderr);
            if (process.ExitCode != 0) throw new InvalidOperationException("The CLI did not complete successfully.");
            return await stdout;
        }
        catch (OperationCanceledException) when (Volatile.Read(ref overflow) != 0)
        { throw new InvalidDataException("The CLI exceeded its bounded output limit."); }
        finally
        {
            lifetime?.Dispose();
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
                catch (Exception ex) when (ex is OperationCanceledException or IOException or InvalidDataException or ObjectDisposedException or TimeoutException) { }
            }
        }
    }

    private static async Task<string> ReadBoundedAsync(StreamReader reader, int maximum, bool retain, Action overflow, CancellationToken ct)
    {
        var result = retain ? new StringBuilder() : null;
        var buffer = new char[4096];
        var total = 0;
        while (await reader.ReadAsync(buffer, ct) is var count && count > 0)
        {
            total += count;
            if (total > maximum) { overflow(); throw new InvalidDataException("The CLI exceeded its bounded output limit."); }
            result?.Append(buffer, 0, count);
        }
        return result?.ToString() ?? "";
    }
}
