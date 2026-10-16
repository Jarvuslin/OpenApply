using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization.Metadata;

namespace OpenApply.Terminal.Preparation;

internal interface IPreparationApi
{
    Task<PreparationManifest> ReadAsync(PreparationRequest request, CancellationToken ct);
    Task<byte[]> DownloadAsync(PreparationRequest request, PreparationSelection selection, CancellationToken ct);
    Task<PreparationStored> StoreAsync(PreparationRequest request, PreparationStoreRequest result, CancellationToken ct);
}

internal sealed class PreparationApi(HttpClient http, string? workItemId = null, string? leaseToken = null) : IPreparationApi, IDisposable
{
    public async Task<PreparationManifest> ReadAsync(PreparationRequest request, CancellationToken ct) =>
        await JsonAsync(request, "/api/jobs/" + request.JobId + "/preparation" + (workItemId is null ? "" : "?mode=worker"), null, AppJsonContext.Default.PreparationManifest, ct);

    public async Task<PreparationStored> StoreAsync(PreparationRequest request, PreparationStoreRequest result, CancellationToken ct) =>
        await JsonAsync(request, "/api/jobs/" + request.JobId + "/preparation/results", JsonContent.Create(result, AppJsonContext.Default.PreparationStoreRequest), AppJsonContext.Default.PreparationStored, ct);

    private async Task<T> JsonAsync<T>(PreparationRequest request, string path, HttpContent? body, JsonTypeInfo<T> type, CancellationToken ct)
    {
        var bytes = await SendAsync(request, path, body, 1_000_000, ct);
        return JsonSerializer.Deserialize(bytes, type) ?? throw new InvalidDataException("Preparation API returned no data.");
    }

    public Task<byte[]> DownloadAsync(PreparationRequest request, PreparationSelection selection, CancellationToken ct)
    {
        if (!Guid.TryParse(selection.Id, out _) || selection.PdfUrl != "/api/application-documents/" + selection.Id + "/pdf")
            throw new InvalidDataException("Document reference is not an owned API artifact.");
        return SendAsync(request, selection.PdfUrl, null, PreparationRuntime.DocumentByteLimit, ct);
    }

    private async Task<byte[]> SendAsync(PreparationRequest request, string path, HttpContent? body, int limit, CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(15));
        using var message = new HttpRequestMessage(body is null ? HttpMethod.Get : HttpMethod.Post, request.ApiUrl.TrimEnd('/') + path) { Content = body };
        message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", request.ApiToken);
        if (workItemId is not null)
        {
            message.Headers.Add("X-OpenApply-Work-Item", workItemId);
            message.Headers.Add("X-OpenApply-Work-Lease", leaseToken);
        }
        using var response = await http.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        if (!response.IsSuccessStatusCode) throw new HttpRequestException($"Preparation API rejected the request ({(int)response.StatusCode}).", null, response.StatusCode);
        if (response.Content.Headers.ContentLength > limit) throw new InvalidDataException("Preparation API response exceeded its bound.");
        await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
        using var output = new MemoryStream();
        var buffer = new byte[8192];
        int length;
        while ((length = await stream.ReadAsync(buffer, timeout.Token)) > 0)
        {
            if (output.Length + length > limit) throw new InvalidDataException("Preparation API response exceeded its bound.");
            output.Write(buffer, 0, length);
        }
        return output.ToArray();
    }

    public void Dispose() => http.Dispose();
}
