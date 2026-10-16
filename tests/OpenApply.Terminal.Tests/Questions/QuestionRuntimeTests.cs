using System.Text.Json;
using Microsoft.AspNetCore.Http;
using OpenApply.Terminal.Agent;
using OpenApply.Terminal.Hosting;
using OpenApply.Terminal.Questions;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed class QuestionRuntimeTests
{
    private static readonly QuestionCollectRequest Request = new("private-api-token", "https://api.example.test", Guid.NewGuid().ToString(), Guid.NewGuid().ToString(), 0);
    private const string Url = "https://jobs.lever.co/company/owned-id";
    private static QuestionObservation Observation => new([], "blocked", "No supported controls.", Url + "/apply");

    [Fact]
    public async Task CollectionWorksInZeroBudgetHostWithoutQueueClaimOrProviderDependency()
    {
        var gate = new AgentRuntimeGate();
        var api = new FakeApi();
        var browser = new FakeBrowser();
        var context = new DefaultHttpContext();
        context.Request.Path = "/questions/collect";
        var called = false;
        await BudgetedHost.RejectOtherEntrypoints(async _ =>
        {
            called = true;
            var result = await new QuestionRuntime(api, browser, gate).CollectAsync(Request, TestContext.Current.CancellationToken);
            Assert.Equal(1, result.CollectionVersion);
        }, true)(context);
        Assert.True(called);
        Assert.Equal(1, api.Reads);
        Assert.Equal(1, api.Stores);
        Assert.Equal(1, browser.Calls);
        Assert.Equal(Url + "/apply", api.Stored!.SourceUrl);
        Assert.Equal(Request.RequestId, api.Stored.RequestId);
        Assert.DoesNotContain(Request.ApiToken, JsonSerializer.Serialize(browser.Request, AppJsonContext.Default.QuestionBrowserRequest));
        Assert.True(gate.TryAcquireQueue());
    }

    [Theory]
    [InlineData("queue")]
    [InlineData("legacy")]
    [InlineData("questions")]
    public async Task BusyGateRejectsBeforeApiOrBrowser(string owner)
    {
        var gate = new AgentRuntimeGate();
        Assert.True(owner switch { "queue" => gate.TryAcquireQueue(), "legacy" => gate.TryAcquireLegacy(), _ => gate.TryAcquireQuestions() });
        var api = new FakeApi();
        var browser = new FakeBrowser();
        await Assert.ThrowsAsync<InvalidOperationException>(() => new QuestionRuntime(api, browser, gate).CollectAsync(Request, TestContext.Current.CancellationToken));
        Assert.Equal(0, api.Reads);
        Assert.Equal(0, browser.Calls);
        Assert.Equal(0, api.Stores);
    }

    [Fact]
    public async Task StaleVersionRejectsBeforeBrowserAndReleasesGate()
    {
        var gate = new AgentRuntimeGate();
        var api = new FakeApi { Version = 1 };
        var browser = new FakeBrowser();
        await Assert.ThrowsAsync<InvalidOperationException>(() => new QuestionRuntime(api, browser, gate).CollectAsync(Request, TestContext.Current.CancellationToken));
        Assert.Equal(0, browser.Calls);
        Assert.Equal(0, api.Stores);
        Assert.True(gate.TryAcquireLegacy());
    }

    [Fact]
    public async Task DifferentJobObservationIsNeverStored()
    {
        var api = new FakeApi();
        var browser = new FakeBrowser { Result = Observation with { SourceUrl = "https://jobs.lever.co/company/another-id/apply" } };
        await Assert.ThrowsAsync<InvalidDataException>(() => new QuestionRuntime(api, browser, new()).CollectAsync(Request, TestContext.Current.CancellationToken));
        Assert.Equal(0, api.Stores);
    }

    [Fact]
    public async Task CancellationWaitsForBrowserCleanupThenReleasesGateWithoutStore()
    {
        var gate = new AgentRuntimeGate();
        var api = new FakeApi();
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var cleaned = false;
        var browser = new FakeBrowser { Run = async ct => { entered.SetResult(); try { await Task.Delay(Timeout.Infinite, ct); } finally { cleaned = true; } return Observation; } };
        using var cancel = new CancellationTokenSource();
        var task = new QuestionRuntime(api, browser, gate).CollectAsync(Request, cancel.Token);
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(2), TestContext.Current.CancellationToken);
        Assert.False(gate.TryAcquireQueue());
        Assert.False(gate.TryAcquireLegacy());
        cancel.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => task);
        Assert.True(cleaned);
        Assert.Equal(0, api.Stores);
        Assert.True(gate.TryAcquireQueue());
    }

    [Theory]
    [InlineData("https://jobs.lever.co/company/owned-id/apply", true)]
    [InlineData("https://jobs.lever.co/company/another-id/apply", false)]
    [InlineData("https://evil.test/company/owned-id/apply", false)]
    [InlineData("https://jobs.lever.co/company/owned-id?other=true", false)]
    public void SameJobUrlIsRequired(string observed, bool expected) => Assert.Equal(expected, QuestionEndpoints.IsSameJobUrl(Url, observed, false));

    [Fact]
    public async Task UnconfirmedBrowserShutdownKeepsGateClosed()
    {
        var gate = new AgentRuntimeGate();
        var api = new FakeApi();
        var browser = new FakeBrowser { Run = _ => throw new QuestionBrowserCleanupException() };
        await Assert.ThrowsAsync<QuestionBrowserCleanupException>(() => new QuestionRuntime(api, browser, gate).CollectAsync(Request, TestContext.Current.CancellationToken));
        Assert.Equal(0, api.Stores);
        Assert.False(gate.TryAcquireQueue());
        Assert.False(gate.TryAcquireLegacy());
    }

    [Fact]
    public void OptionalNullsAreOmittedFromObservationContract()
    {
        var definition = new QuestionDefinition("fields:name", "Name", null, "required", "visible", new("unconditional", []), "all", [new("name", null, "text", [])]);
        var body = new QuestionStoreRequest(Request.RequestId, 0, "browser_dom", Url, "complete", "openapply-dom-v1", null, [definition]);
        var json = JsonSerializer.Serialize(body, AppJsonContext.Default.QuestionStoreRequest);
        Assert.DoesNotContain(":null", json);
        Assert.Contains("\"definitions\"", json);
    }

    [Fact]
    public void LoopbackNeedsHostOptInAndBrowserProcessCannotInheritCredentials()
    {
        Assert.False(QuestionEndpoints.IsCollectionUrl("http://127.0.0.1:4444/form", false));
        Assert.True(QuestionEndpoints.IsCollectionUrl("http://127.0.0.1:4444/form", true));
        var start = QuestionBrowser.BuildStart("node", new InstallPaths { WorkingDir = Path.GetTempPath(), PluginDir = Path.Combine(Path.GetTempPath(), "plugin") });
        Assert.Single(start.ArgumentList);
        Assert.EndsWith("collect-questions.mjs", start.ArgumentList[0]);
        Assert.DoesNotContain(start.Environment.Keys, key => key.Contains("TOKEN", StringComparison.OrdinalIgnoreCase) || key.Contains("KEY", StringComparison.OrdinalIgnoreCase) || key == "WSLENV");
        Assert.DoesNotContain(start.ArgumentList, argument => argument.Contains(Request.ApiToken));
    }

    private sealed class FakeApi : IQuestionApi
    {
        public int Reads, Stores, Version;
        public QuestionStoreRequest? Stored;
        public Task<QuestionSnapshot> ReadAsync(QuestionCollectRequest request, CancellationToken ct) { Reads++; return Task.FromResult(new QuestionSnapshot(new(request.JobId, Url), Version, null, [])); }
        public Task<QuestionSnapshot> StoreAsync(QuestionCollectRequest request, QuestionStoreRequest observation, CancellationToken ct)
        {
            Stores++; Stored = observation;
            return Task.FromResult(new QuestionSnapshot(new(request.JobId, Url), Version + 1, new(observation.Coverage, observation.Reason), []));
        }
    }

    private sealed class FakeBrowser : IQuestionBrowser
    {
        public int Calls;
        public QuestionBrowserRequest? Request;
        public QuestionObservation Result = Observation;
        public Func<CancellationToken, Task<QuestionObservation>>? Run;
        public Task<QuestionObservation> CollectAsync(QuestionBrowserRequest request, CancellationToken ct) { Calls++; Request = request; return Run?.Invoke(ct) ?? Task.FromResult(Result); }
    }
}
