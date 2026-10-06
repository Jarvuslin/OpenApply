using System.Net.Http.Headers;
using System.Net.Http.Json;

namespace OpenApply.Terminal.Pilot;

/// <summary>GET /api/pilot/activity.</summary>
public sealed record PilotActivity(bool Running, DateTimeOffset? LastActivityAt, CompletedCycle? LastCycle);

public sealed record CompletedCycle(string? CycleId, DateTimeOffset CompletedAt, string? Status, int? SleepSeconds);

internal sealed record JournalRequest(JournalEntry[] Entries);

internal sealed record JournalEntry(string Kind, string Summary);

/// <summary>Probes and reports throw only on the caller's cancellation, so a briefly unreachable API cannot take the loop down.</summary>
public sealed class PilotApi(HttpClient http, ILogger<PilotApi> logger)
{
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(10);

    public async Task<PilotActivity?> GetActivityAsync(PilotSettings settings, CancellationToken ct)
    {
        try
        {
            using var timeout = TimeoutAfter(ct);
            using var request = Request(settings, HttpMethod.Get, "/api/pilot/activity");
            using var response = await http.SendAsync(request, timeout.Token);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("Pilot activity probe was rejected ({Status}).", (int)response.StatusCode);
                return null;
            }

            return await response.Content.ReadFromJsonAsync(AppJsonContext.Default.PilotActivity, timeout.Token);
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            logger.LogWarning(ex, "Pilot activity probe failed.");
            return null;
        }
    }

    public async Task ReportAsync(PilotSettings settings, string summary, CancellationToken ct)
    {
        try
        {
            using var timeout = TimeoutAfter(ct);
            using var request = Request(settings, HttpMethod.Post, "/api/pilot/journal");
            request.Content = JsonContent.Create(
                new JournalRequest([new JournalEntry("system", summary)]), AppJsonContext.Default.JournalRequest);
            using var response = await http.SendAsync(request, timeout.Token);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("Pilot journal report was rejected ({Status}).", (int)response.StatusCode);
            }
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            logger.LogWarning(ex, "Pilot journal report could not be delivered.");
        }
    }

    /// <summary>Null when the server rejects the stream. Unlike the calls above, transport failures throw.</summary>
    public async Task<HttpResponseMessage?> OpenEventsAsync(PilotSettings settings, CancellationToken ct)
    {
        var request = Request(settings, HttpMethod.Get, "/api/pilot/events");
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
        var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        if (response.IsSuccessStatusCode)
        {
            return response;
        }

        logger.LogWarning("Pilot event stream was rejected ({Status}).", (int)response.StatusCode);
        response.Dispose();
        return null;
    }

    private static HttpRequestMessage Request(PilotSettings settings, HttpMethod method, string path)
    {
        var request = new HttpRequestMessage(method, settings.ApiUrl.TrimEnd('/') + path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.ApiToken);
        return request;
    }

    private static CancellationTokenSource TimeoutAfter(CancellationToken ct)
    {
        var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(RequestTimeout);
        return timeout;
    }
}
