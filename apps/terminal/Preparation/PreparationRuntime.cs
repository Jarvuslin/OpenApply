using System.Security.Cryptography;
using OpenApply.Terminal.Agent;
using OpenApply.Terminal.Questions;

namespace OpenApply.Terminal.Preparation;

internal interface IPreparationBrowser
{
    Task<PreparationObservation> FillAsync(PreparationBrowserRequest request, CancellationToken ct);
}

internal sealed class PreparationRuntime(IPreparationApi api, IPreparationBrowser browser, AgentRuntimeGate gate)
{
    internal const int DocumentByteLimit = 10_000_000;

    internal async Task<PreparationResult> FillAsync(PreparationRequest request, CancellationToken ct)
    {
        if (!gate.TryAcquirePreparation()) throw new InvalidOperationException("The browser is busy. Stop active queue work, question collection or terminal work before checking preparation.");
        var release = true;
        try { return await FillCoreAsync(request, "preview", ct); }
        catch (QuestionBrowserCleanupException) { release = false; throw; }
        finally { if (release) gate.ReleasePreparation(); }
    }

    internal Task<PreparationResult> FillWorkerAsync(PreparationRequest request, CancellationToken ct) => FillCoreAsync(request, "worker", ct);

    private async Task<PreparationResult> FillCoreAsync(PreparationRequest request, string mode, CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(90));
        try
        {
            var manifest = await api.ReadAsync(request, timeout.Token);
            if (manifest.Job.Id != request.JobId || manifest.Mode != mode || manifest.SubmissionAllowed || manifest.Questions is null || manifest.Questions.Length > 200 || manifest.DocumentFields is null || manifest.DocumentFields.Length > 4000)
                throw new InvalidDataException("Preparation API returned an invalid owned manifest.");
            if (manifest.CollectionVersion != request.ExpectedCollectionVersion || manifest.ManifestHash != request.ManifestHash)
                throw new InvalidOperationException("Preparation changed. Refresh and review the current questions and documents.");
            var allowLoopback = Environment.GetEnvironmentVariable("OPENAPPLY_QUESTION_ALLOW_LOOPBACK") == "1";
            if (!QuestionEndpoints.IsCollectionUrl(manifest.Job.Url, allowLoopback))
                throw new ArgumentException("Preparation supports official Greenhouse, Lever and Ashby application URLs.");
            var documents = new List<PreparationDocument>();
            var bytesTotal = 0;
            var available = manifest.DocumentFields.Where(field => field.Purpose == "resume" && field.Selection is { Current: true, Available: true, ConfirmedAt: not null }).ToArray();
            var overLimit = available.Length > 4 || available.Sum(field => (long)field.Selection!.SizeBytes) > DocumentByteLimit;
            foreach (var field in manifest.DocumentFields)
            {
                var selection = field.Selection;
                if (field.Purpose != "resume" || selection is not { Current: true, Available: true, ConfirmedAt: not null }) continue;
                if (selection.JobId != request.JobId || selection.QuestionId != field.QuestionId || selection.FieldKey != field.FieldKey || selection.SizeBytes is < 1 or > DocumentByteLimit || !PreparationEndpoints.IsHash(selection.PdfSha256))
                    throw new InvalidDataException("Document selection does not match the owned field.");
                if (overLimit) continue;
                if (documents.Count >= 4 || bytesTotal + selection.SizeBytes > DocumentByteLimit) throw new InvalidDataException("Selected documents exceed the preparation byte limit.");
                var bytes = await api.DownloadAsync(request, selection, timeout.Token);
                if (bytes.Length != selection.SizeBytes || !bytes.AsSpan().StartsWith("%PDF-"u8) || Convert.ToHexStringLower(SHA256.HashData(bytes)) != selection.PdfSha256)
                    throw new InvalidDataException("The selected PDF does not match its retained identity.");
                bytesTotal += bytes.Length;
                documents.Add(new(field.QuestionId, field.FieldKey, selection.PdfSha256, bytes.Length, Convert.ToBase64String(bytes)));
            }
            var result = overLimit
                ? new PreparationObservation(manifest.Job.Url, "blocked", [], "Selected PDFs exceed the preview limit of four files and 10 MB combined.")
                : await browser.FillAsync(new(manifest, documents.ToArray(), allowLoopback), timeout.Token);
            if (!QuestionEndpoints.IsSameJobUrl(manifest.Job.Url, result.SourceUrl, allowLoopback) || result.Status is not ("filled" or "partial" or "blocked") || result.Fields is null || result.Fields.Length > 4000 || result.Reason?.Length > 1000)
                throw new InvalidDataException("Preparation returned invalid evidence.");
            var known = new HashSet<string>();
            foreach (var question in manifest.Questions)
                foreach (var field in question.GetProperty("definition").GetProperty("fields").EnumerateArray())
                    known.Add(question.GetProperty("id").GetString() + ":" + field.GetProperty("key").GetString());
            var seen = new HashSet<string>();
            foreach (var field in result.Fields)
                if (!known.Contains(field.QuestionId + ":" + field.FieldKey) || !seen.Add(field.QuestionId + ":" + field.FieldKey) || field.Status is not ("verified" or "omitted" or "blocked" or "mismatch") || field.Reason?.Length > 1000 || field.PdfSha256 is not null && !PreparationEndpoints.IsHash(field.PdfSha256) || field.Status == "omitted" && (field.Value is not null || field.PdfSha256 is not null))
                    throw new InvalidDataException("Preparation returned an unknown or repeated field.");
            var adapter = mode == "worker" ? "native-owned-v1" : "native-preview-v1";
            var stored = await api.StoreAsync(request, new(request.RequestId, manifest.CollectionVersion, manifest.ManifestHash, mode, result.SourceUrl, adapter, result.Status, result.Fields, result.Reason), timeout.Token);
            if (stored.JobId != request.JobId || stored.RequestId != request.RequestId || stored.ManifestHash != manifest.ManifestHash || stored.CollectionVersion != manifest.CollectionVersion || stored.Mode != mode || stored.Status != result.Status || stored.Verification != "observed" || stored.SubmissionAllowed)
                throw new InvalidDataException("Preparation API did not acknowledge this preview evidence.");
            return new(request.JobId, manifest.CollectionVersion, manifest.ManifestHash, result.Status, result.Fields, result.Reason, stored.Id, "observed", ContextRetained: mode == "worker");
        }
        finally { }
    }
}
