using System.Net;
using OpenApply.Terminal.Preparation;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed class PreparationApiTests
{
    private static readonly PreparationRequest Request = new("synthetic-private-token", "https://api.example.test", Guid.NewGuid().ToString(), Guid.NewGuid().ToString(), 1, new('a', 64));
    private static PreparationSelection Selection
    {
        get
        {
            var id = Guid.NewGuid().ToString();
            return new(id, Guid.NewGuid().ToString(), Request.JobId, "resume", new('b', 64), 8, DateTimeOffset.UtcNow, true, true, "/api/application-documents/" + id + "/pdf");
        }
    }

    [Fact]
    public async Task ArtifactDownloadUsesOnlyExactOwnedApiPathAndHostAuthorization()
    {
        var selection = Selection;
        var handler = new Handler(message =>
        {
            Assert.Equal("https://api.example.test" + selection.PdfUrl, message.RequestUri!.AbsoluteUri);
            Assert.Equal(HttpMethod.Get, message.Method);
            Assert.Equal("Bearer", message.Headers.Authorization!.Scheme);
            Assert.Equal(Request.ApiToken, message.Headers.Authorization.Parameter);
            return new(HttpStatusCode.OK) { Content = new ByteArrayContent("%PDF-1.4"u8.ToArray()) };
        });
        using var api = new PreparationApi(new HttpClient(handler));
        Assert.Equal("%PDF-1.4"u8.ToArray(), await api.DownloadAsync(Request, selection, TestContext.Current.CancellationToken));
        Assert.Equal(1, handler.Calls);
    }

    [Theory]
    [InlineData("https://external.test/resume.pdf")]
    [InlineData("/api/resumes/other/pdf")]
    [InlineData("/api/application-documents/../other/pdf")]
    public async Task ExternalOrUnownedArtifactReferencesRejectBeforeRequest(string path)
    {
        var handler = new Handler(_ => throw new InvalidOperationException("No request expected"));
        using var api = new PreparationApi(new HttpClient(handler));
        await Assert.ThrowsAsync<InvalidDataException>(() => api.DownloadAsync(Request, Selection with { PdfUrl = path }, TestContext.Current.CancellationToken));
        Assert.Equal(0, handler.Calls);
    }

    [Fact]
    public async Task RedirectResponseIsNotAcceptedAsArtifactEvidence()
    {
        var handler = new Handler(_ => new(HttpStatusCode.Redirect) { Headers = { Location = new("https://external.test/resume.pdf") } });
        using var api = new PreparationApi(new HttpClient(handler));
        await Assert.ThrowsAsync<HttpRequestException>(() => api.DownloadAsync(Request, Selection, TestContext.Current.CancellationToken));
        Assert.Equal(1, handler.Calls);
    }

    [Fact]
    public async Task OversizedArtifactResponseIsRejectedBeforeReadingItsBytes()
    {
        var handler = new Handler(_ =>
        {
            var response = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent([]) };
            response.Content.Headers.ContentLength = PreparationRuntime.DocumentByteLimit + 1;
            return response;
        });
        using var api = new PreparationApi(new HttpClient(handler));
        await Assert.ThrowsAsync<InvalidDataException>(() => api.DownloadAsync(Request, Selection, TestContext.Current.CancellationToken));
    }

    private sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public int Calls;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) { Calls++; return Task.FromResult(respond(request)); }
    }
}
