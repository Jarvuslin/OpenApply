using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization.Metadata;
using OpenApply.Terminal.Agent;
using OpenApply.Terminal.Hosting;
using OpenApply.Terminal.Providers;

namespace OpenApply.Terminal.Questions;

internal sealed class QuestionBrowserCleanupException() : IOException("Question browser shutdown could not be confirmed. Restart the companion before starting more browser work.");

internal sealed class QuestionBrowser(HostInstall install) : IQuestionBrowser
{
    public Task<QuestionObservation> CollectAsync(QuestionBrowserRequest request, CancellationToken ct)
    {
        var paths = install.RequirePaths();
        var node = ExecutablePath.Find("node") ?? throw new InvalidOperationException("Install the browser runtime before collecting questions.");
        var start = BuildStart(node, paths);
        return RunAsync(start, request, ct);
    }

    internal static ProcessStartInfo BuildStart(string node, InstallPaths paths, string helper = "collect-questions.mjs")
    {
        var start = new ProcessStartInfo(node)
        {
            WorkingDirectory = paths.WorkingDir, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            StandardInputEncoding = new System.Text.UTF8Encoding(false, true),
            StandardOutputEncoding = new System.Text.UTF8Encoding(false, true),
        };
        start.ArgumentList.Add(Path.Combine(paths.BinDir, helper));
        string[] keep = ["PATH", "SystemRoot", "WINDIR", "USERPROFILE", "HOME", "HOMEDRIVE", "HOMEPATH", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA"];
        foreach (var key in start.Environment.Keys.ToArray())
            if (!keep.Contains(key, StringComparer.OrdinalIgnoreCase)) start.Environment.Remove(key);
        return start;
    }

    internal static Task<QuestionObservation> RunAsync(ProcessStartInfo start, QuestionBrowserRequest request, CancellationToken ct) =>
        RunHelperAsync(start, request, AppJsonContext.Default.QuestionBrowserRequest, AppJsonContext.Default.QuestionObservation, ct);

    internal static async Task<TOutput> RunHelperAsync<TInput, TOutput>(ProcessStartInfo start, TInput request, JsonTypeInfo<TInput> inputType, JsonTypeInfo<TOutput> outputType, CancellationToken ct)
    {
        using var process = new Process { StartInfo = start };
        ct.ThrowIfCancellationRequested();
        process.Start();
        IDisposable? lifetime = null;
        var stderr = process.StandardError.ReadToEndAsync();
        var output = ReadBoundedAsync(process.StandardOutput);
        try
        {
            lifetime = AgentProcessLifetime.Attach(process);
            await process.StandardInput.WriteLineAsync(JsonSerializer.Serialize(request, inputType).AsMemory(), ct);
            await process.StandardInput.FlushAsync(ct);
            var exit = process.WaitForExitAsync(ct);
            if (await Task.WhenAny(exit, output) == output) await output;
            await exit;
            var body = await output;
            if (process.ExitCode != 0) throw new InvalidDataException("The question browser ended without observations.");
            return JsonSerializer.Deserialize(body, outputType) ?? throw new InvalidDataException("The browser returned no observations.");
        }
        finally
        {
            // Closing the input asks the helper to close its isolated guest browser before releasing the gate.
            process.StandardInput.Close();
            try { await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(8)); }
            catch (TimeoutException)
            {
                if (!process.HasExited) process.Kill(entireProcessTree: true);
                throw new QuestionBrowserCleanupException();
            }
            try { await Task.WhenAll(output, stderr).WaitAsync(TimeSpan.FromSeconds(2)); }
            catch (Exception error) when (error is IOException or TimeoutException or InvalidDataException) { }
            lifetime?.Dispose();
        }
    }

    private static async Task<string> ReadBoundedAsync(StreamReader reader)
    {
        var buffer = new char[4096];
        var body = new System.Text.StringBuilder();
        int length;
        while ((length = await reader.ReadAsync(buffer)) != 0)
        {
            body.Append(buffer, 0, length);
            if (body.Length > 2_000_000) throw new InvalidDataException("Question observations exceeded the output limit.");
        }
        return body.ToString();
    }
}
