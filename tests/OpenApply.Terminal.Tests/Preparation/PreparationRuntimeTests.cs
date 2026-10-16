using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using OpenApply.Terminal.Agent;
using OpenApply.Terminal.Hosting;
using OpenApply.Terminal.Preparation;
using OpenApply.Terminal.Questions;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed class PreparationRuntimeTests
{
    private const string Url = "https://jobs.lever.co/company/job";
    private static readonly string QuestionId = Guid.NewGuid().ToString();
    private static readonly PreparationRequest Request = new("private-api-token", "https://api.example.test", Guid.NewGuid().ToString(), Guid.NewGuid().ToString(), 1, new('a', 64));
    private static readonly byte[] Pdf = "%PDF-1.4\nfixture\n%%EOF"u8.ToArray();
    private static readonly string Hash = Convert.ToHexStringLower(SHA256.HashData(Pdf));
    private static PreparationManifest Manifest => new(new(Request.JobId, Url), 1, "partial", Request.ManifestHash, "preview",
        [JsonSerializer.SerializeToElement(new { id = QuestionId, jobId = Request.JobId, current = true, definition = new { fields = new[] { new { key = "resume" } } } })],
        [new(QuestionId, "resume", "resume", new(Guid.NewGuid().ToString(), QuestionId, Request.JobId, "resume", Hash, Pdf.Length, DateTimeOffset.UtcNow, true, true, "/unused-in-fake"))], false);

    [Fact]
    public async Task PreviewWorksAtZeroModelBudgetWithVerifiedBytesAndNoCredentialsInGuestInput()
    {
        var api = new FakeApi(); var browser = new FakeBrowser(); var gate = new AgentRuntimeGate();
        var context = new DefaultHttpContext(); context.Request.Path = "/preparation/fill";
        PreparationResult? result = null;
        await BudgetedHost.RejectOtherEntrypoints(async _ => result = await new PreparationRuntime(api, browser, gate).FillAsync(Request, TestContext.Current.CancellationToken), true)(context);
        Assert.NotNull(result); Assert.False(result.ContextRetained); Assert.False(result.SubmissionAllowed);
        Assert.Equal(1, api.Reads); Assert.Equal(1, api.Downloads); Assert.Equal(1, api.Stores);
        Assert.Equal(Hash, browser.Request!.Documents[0].PdfSha256);
        Assert.Equal(Pdf, Convert.FromBase64String(browser.Request.Documents[0].Base64));
        Assert.DoesNotContain(Request.ApiToken, JsonSerializer.Serialize(browser.Request, AppJsonContext.Default.PreparationBrowserRequest));
        Assert.True(gate.TryAcquireQueue());
    }

    [Theory]
    [InlineData("queue")][InlineData("legacy")][InlineData("questions")][InlineData("preparation")]
    public async Task BusyGateRejectsBeforeAnyApiRead(string owner)
    {
        var gate = new AgentRuntimeGate();
        Assert.True(owner switch { "queue" => gate.TryAcquireQueue(), "legacy" => gate.TryAcquireLegacy(), "questions" => gate.TryAcquireQuestions(), _ => gate.TryAcquirePreparation() });
        var api = new FakeApi();
        await Assert.ThrowsAsync<InvalidOperationException>(() => new PreparationRuntime(api, new FakeBrowser(), gate).FillAsync(Request, TestContext.Current.CancellationToken));
        Assert.Equal(0, api.Reads);
    }

    [Fact]
    public async Task StaleManifestRejectsBeforeDownloadOrBrowser()
    {
        var api = new FakeApi { Snapshot = Manifest with { ManifestHash = new('b', 64) } }; var browser = new FakeBrowser(); var gate = new AgentRuntimeGate();
        await Assert.ThrowsAsync<InvalidOperationException>(() => new PreparationRuntime(api, browser, gate).FillAsync(Request, TestContext.Current.CancellationToken));
        Assert.Equal(0, api.Downloads); Assert.Equal(0, browser.Calls); Assert.True(gate.TryAcquireLegacy());
    }

    [Fact]
    public async Task DifferentPdfBytesAreNeverPassedToBrowserOrStored()
    {
        var api = new FakeApi { Bytes = "%PDF-other"u8.ToArray() }; var browser = new FakeBrowser();
        await Assert.ThrowsAsync<InvalidDataException>(() => new PreparationRuntime(api, browser, new()).FillAsync(Request, TestContext.Current.CancellationToken));
        Assert.Equal(0, browser.Calls); Assert.Equal(0, api.Stores);
    }

    [Fact]
    public async Task DifferentJobOrUnknownFieldEvidenceCannotBeStored()
    {
        foreach (var observation in new[] {
            new PreparationObservation("https://jobs.lever.co/company/other", "blocked", [], null),
            new PreparationObservation(Url, "partial", [new(Guid.NewGuid().ToString(), "unknown", "blocked")], null) })
        {
            var api = new FakeApi(); var browser = new FakeBrowser { Result = observation };
            await Assert.ThrowsAsync<InvalidDataException>(() => new PreparationRuntime(api, browser, new()).FillAsync(Request, TestContext.Current.CancellationToken));
            Assert.Equal(0, api.Stores);
        }
    }

    [Fact]
    public async Task UnconfirmedShutdownKeepsAllBrowserOwnersBlocked()
    {
        var gate = new AgentRuntimeGate(); var api = new FakeApi(); var browser = new FakeBrowser { Failure = new QuestionBrowserCleanupException() };
        await Assert.ThrowsAsync<QuestionBrowserCleanupException>(() => new PreparationRuntime(api, browser, gate).FillAsync(Request, TestContext.Current.CancellationToken));
        Assert.False(gate.TryAcquireLegacy()); Assert.False(gate.TryAcquireQueue()); Assert.False(gate.TryAcquireQuestions()); Assert.Equal(0, api.Stores);
    }

    [Fact]
    public async Task CancellationWaitsForBrowserCleanupAndNeverStoresIncompleteEvidence()
    {
        var gate = new AgentRuntimeGate(); var api = new FakeApi();
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var cleaned = false;
        var browser = new FakeBrowser { Run = async ct => { entered.SetResult(); try { await Task.Delay(Timeout.Infinite, ct); } finally { cleaned = true; } return new(Url, "blocked", [], null); } };
        using var cancel = new CancellationTokenSource();
        var task = new PreparationRuntime(api, browser, gate).FillAsync(Request, cancel.Token);
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(2), TestContext.Current.CancellationToken);
        Assert.False(gate.TryAcquireQueue()); cancel.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => task);
        Assert.True(cleaned); Assert.Equal(0, api.Stores); Assert.True(gate.TryAcquireQuestions());
    }

    [Fact]
    public async Task AggregateDocumentLimitStoresBlockedEvidenceWithoutBrowserOrDownloads()
    {
        var snapshot = Manifest;
        var documents = Enumerable.Range(0, 5).Select(_ => snapshot.DocumentFields[0]).ToArray();
        var api = new FakeApi { Snapshot = snapshot with { DocumentFields = documents } }; var browser = new FakeBrowser();
        var result = await new PreparationRuntime(api, browser, new()).FillAsync(Request, TestContext.Current.CancellationToken);
        Assert.Equal("blocked", result.Status); Assert.Contains("four files", result.Reason);
        Assert.Equal(0, api.Downloads); Assert.Equal(0, browser.Calls); Assert.Equal(1, api.Stores);
    }

    [Fact]
    public async Task OmittedReadbackSurvivesRuntimeWithoutSerializingAFactOrPdfHash()
    {
        var api = new FakeApi { Snapshot = Manifest with { DocumentFields = [] } };
        var browser = new FakeBrowser { Result = new(Url, "filled", [new(QuestionId, "resume", "omitted", Reason: "Optional field observed blank.")], null) };
        var result = await new PreparationRuntime(api, browser, new()).FillAsync(Request, TestContext.Current.CancellationToken);
        Assert.Equal("omitted", Assert.Single(result.Fields).Status);
        var json = JsonSerializer.Serialize(result, AppJsonContext.Default.PreparationResult);
        Assert.DoesNotContain("\"value\"", json); Assert.DoesNotContain("\"pdfSha256\"", json);
        Assert.Equal(1, api.Stores);
    }

    [Fact]
    public async Task OmittedReadbackWithAFactualValueIsRejectedBeforeStore()
    {
        var api = new FakeApi();
        var browser = new FakeBrowser { Result = new(Url, "filled", [new(QuestionId, "resume", "omitted", Value: JsonSerializer.SerializeToElement(false))], null) };
        await Assert.ThrowsAsync<InvalidDataException>(() => new PreparationRuntime(api, browser, new()).FillAsync(Request, TestContext.Current.CancellationToken));
        Assert.Equal(0, api.Stores);
    }

    private sealed class FakeApi : IPreparationApi
    {
        public int Reads, Downloads, Stores;
        public PreparationManifest Snapshot = Manifest;
        public byte[] Bytes = Pdf;
        public Task<PreparationManifest> ReadAsync(PreparationRequest request, CancellationToken ct) { Reads++; return Task.FromResult(Snapshot); }
        public Task<byte[]> DownloadAsync(PreparationRequest request, PreparationSelection selection, CancellationToken ct) { Downloads++; return Task.FromResult(Bytes); }
        public Task<PreparationStored> StoreAsync(PreparationRequest request, PreparationStoreRequest result, CancellationToken ct) { Stores++; return Task.FromResult(new PreparationStored(Guid.NewGuid().ToString(), request.JobId, request.RequestId, result.ExpectedCollectionVersion, result.ManifestHash, result.Mode, result.Status, "observed", false)); }
    }

    private sealed class FakeBrowser : IPreparationBrowser
    {
        public int Calls; public PreparationBrowserRequest? Request;
        public PreparationObservation Result = new(Url + "/apply", "partial", [new(QuestionId, "resume", "verified", PdfSha256: Hash)], "Review required.");
        public Exception? Failure;
        public Func<CancellationToken, Task<PreparationObservation>>? Run;
        public Task<PreparationObservation> FillAsync(PreparationBrowserRequest request, CancellationToken ct) { Calls++; Request = request; if (Failure is not null) throw Failure; return Run?.Invoke(ct) ?? Task.FromResult(Result); }
    }
}
