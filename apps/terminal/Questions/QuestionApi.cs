using System.Net.Http.Headers;
using System.Net.Http.Json;

namespace OpenApply.Terminal.Questions;

internal sealed class QuestionApi(HttpClient http) : IQuestionApi
{
    public Task<QuestionSnapshot> ReadAsync(QuestionCollectRequest request, CancellationToken ct) => SendAsync(request, null, ct);
    public Task<QuestionSnapshot> StoreAsync(QuestionCollectRequest request, QuestionStoreRequest observations, CancellationToken ct) => SendAsync(request, observations, ct);

    private async Task<QuestionSnapshot> SendAsync(QuestionCollectRequest request, QuestionStoreRequest? observations, CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(10));
        using var message = new HttpRequestMessage(observations is null ? HttpMethod.Get : HttpMethod.Put,
            request.ApiUrl.TrimEnd('/') + "/api/jobs/" + Uri.EscapeDataString(request.JobId) + "/questions" + (observations is null ? "" : "/observations"));
        message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", request.ApiToken);
        if (observations is not null) message.Content = JsonContent.Create(observations, AppJsonContext.Default.QuestionStoreRequest);
        using var response = await http.SendAsync(message, timeout.Token);
        if (!response.IsSuccessStatusCode) throw new HttpRequestException($"Question API rejected the request ({(int)response.StatusCode}).", null, response.StatusCode);
        return await response.Content.ReadFromJsonAsync(AppJsonContext.Default.QuestionSnapshot, timeout.Token)
            ?? throw new InvalidDataException("The question API returned no job.");
    }
}
