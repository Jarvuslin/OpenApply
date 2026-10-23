using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;
using OpenApply.Terminal.Agent;

namespace OpenApply.Terminal.Queue;

internal interface IAccountBrokerApi
{
    Task<JsonObject> CallAsync(ApiConnection connection, string action, JsonObject? input, CancellationToken ct);
}

internal sealed class AccountBrokerApi : IAccountBrokerApi
{
    public async Task<JsonObject> CallAsync(ApiConnection connection, string action, JsonObject? input, CancellationToken ct)
    {
        if (action is not ("context" or "credential" or "begin" or "observe")) throw new InvalidOperationException("Unknown account capability route.");
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(TimeSpan.FromSeconds(10));
        using var http = new HttpClient(new SocketsHttpHandler { AllowAutoRedirect = false }) { Timeout = Timeout.InfiniteTimeSpan };
        using var request = new HttpRequestMessage(input is null ? HttpMethod.Get : HttpMethod.Post, connection.ApiUrl.TrimEnd('/') + "/api/account-setup/" + action);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", connection.ApiToken);
        if (input is not null) request.Content = new StringContent(input.ToJsonString(), Encoding.UTF8, "application/json");
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
        response.EnsureSuccessStatusCode();
        if (response.Content.Headers.ContentLength > 131072) throw new InvalidDataException("Account response exceeded its bound.");
        using var stream = await response.Content.ReadAsStreamAsync(deadline.Token);
        using var memory = new MemoryStream();
        var buffer = new byte[4096];
        while (await stream.ReadAsync(buffer, deadline.Token) is var count && count > 0)
        {
            if (memory.Length + count > 131072) throw new InvalidDataException("Account response exceeded its bound.");
            memory.Write(buffer, 0, count);
        }
        return JsonNode.Parse(memory.ToArray()) as JsonObject ?? throw new InvalidDataException("Invalid account response.");
    }
}
