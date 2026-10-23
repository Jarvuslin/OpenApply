using OpenApply.Terminal.Agent;
using OpenApply.Terminal.Queue;

namespace OpenApply.Terminal.Questions;

public static class QuestionEndpoints
{
    public static void MapQuestionEndpoints(this WebApplication app) => app.MapPost("/questions/collect", async (QuestionCollectRequest request, QuestionRuntime runtime, CancellationToken ct) =>
    {
        if (string.IsNullOrWhiteSpace(request.ApiToken) || request.ApiToken.Length > 16000 || !QueueEndpoints.IsServiceUrl(request.ApiUrl)
            || !Guid.TryParse(request.JobId, out _) || !Guid.TryParse(request.RequestId, out _) || request.ExpectedCollectionVersion < 0)
            return Results.Problem("Provide an authenticated API URL, job ID, request ID and collection version.", statusCode: 400);
        try { return Results.Ok(await runtime.CollectAsync(request, ct)); }
        catch (ArgumentException ex) { return Results.Problem(ex.Message, statusCode: 400); }
        catch (InvalidOperationException ex) { return Results.Problem(ex.Message, statusCode: 409); }
        catch (QuestionBrowserCleanupException ex) { return Results.Problem(ex.Message, statusCode: 502); }
        catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.Conflict)
        { return Results.Problem("Questions changed. Refresh the job before collecting again.", statusCode: 409); }
        catch (Exception ex) when (ex is HttpRequestException or InvalidDataException or OperationCanceledException or System.ComponentModel.Win32Exception)
        { return Results.Problem("Could not collect questions. Check sign-in, the installed browser and the job URL, then retry explicitly.", statusCode: 502); }
    });

    internal static bool IsCollectionUrl(string value, bool allowLoopback)
    {
        if (value.Length > 4000 || !Uri.TryCreate(value, UriKind.Absolute, out var url) || url.UserInfo.Length > 0 || url.Fragment.Length > 0) return false;
        if (allowLoopback && url.Host is "127.0.0.1" or "localhost" or "[::1]") return url.Scheme == "http" && url.Port >= 1024;
        if (url.Scheme != "https" || !url.IsDefaultPort) return false;
        var segments = url.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
        return url.Host switch
        {
            "boards.greenhouse.io" or "job-boards.greenhouse.io" or "boards.eu.greenhouse.io" or "job-boards.eu.greenhouse.io" => segments.Length == 3 && segments[1] == "jobs",
            "jobs.lever.co" or "jobs.eu.lever.co" => segments.Length == 2 || segments.Length == 3 && segments[2] == "apply",
            "jobs.ashbyhq.com" => segments.Length == 2 || segments.Length == 3 && segments[2] == "application",
            _ => false,
        };
    }

    internal static bool IsSameJobUrl(string original, string observed, bool allowLoopback)
    {
        if (!IsCollectionUrl(original, allowLoopback) || !IsCollectionUrl(observed, allowLoopback)) return false;
        var first = new Uri(original);
        var second = new Uri(observed);
        if (first.GetLeftPart(UriPartial.Authority) != second.GetLeftPart(UriPartial.Authority) || first.Query != second.Query) return false;
        static string BasePath(Uri url)
        {
            var value = url.AbsolutePath.TrimEnd('/');
            var suffix = url.Host == "jobs.ashbyhq.com" ? "/application" : "/apply";
            if (url.Host is "jobs.lever.co" or "jobs.eu.lever.co" or "jobs.ashbyhq.com" && value.EndsWith(suffix, StringComparison.Ordinal)) value = value[..^suffix.Length];
            return value;
        }
        return BasePath(first) == BasePath(second);
    }
}
