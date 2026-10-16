using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization.Metadata;
using OpenApply.Terminal.Agent;

namespace OpenApply.Terminal.Queue;

internal interface IQueueApi
{
    Task<string> VerifyAsync(ApiConnection connection, CancellationToken ct);
    Task<QueueObserver> ObserverAsync(ApiConnection connection, string workItemId, string executionId, string browserSessionId, CancellationToken ct);
    Task<QueueOrder> OrderedAsync(ApiConnection connection, string[] workItemIds, CancellationToken ct);
    Task<QueueClaimResponse> ClaimAsync(ApiConnection connection, QueueClaimRequest input, CancellationToken ct);
    Task<WorkItem?> HeartbeatAsync(ApiConnection connection, QueueClaim claim, CancellationToken ct);
    Task EventAsync(ApiConnection connection, QueueClaim claim, WorkEvent entry, CancellationToken ct);
    Task FinishAsync(ApiConnection connection, QueueClaim claim, AgentResult result, CancellationToken ct);
    Task<AccountSetupSnapshot> AccountSnapshotAsync(ApiConnection connection, string workItemId, CancellationToken ct) => throw new NotSupportedException();
    Task<QueueRunnable> RunnableAsync(ApiConnection connection, CancellationToken ct) => throw new NotSupportedException();
    Task<JsonObject?> JobLoginAsync(ApiConnection connection, CancellationToken ct) => throw new NotSupportedException();
}

internal sealed class QueueApi(HttpClient http) : IQueueApi
{
    public async Task<AccountSetupSnapshot> AccountSnapshotAsync(ApiConnection connection, string workItemId, CancellationToken ct)
    {
        using var timeout = Deadline(ct);
        using var request = Request(connection, HttpMethod.Get, $"/api/account-setup/{Uri.EscapeDataString(workItemId)}/snapshot");
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        EnsureSuccess(response);
        return await ReadBoundedAsync(response, AppJsonContext.Default.AccountSetupSnapshot, timeout.Token);
    }
    public async Task<string> VerifyAsync(ApiConnection connection, CancellationToken ct)
    {
        using var timeout = Deadline(ct);
        using var request = Request(connection, HttpMethod.Get, "/api/auth/me");
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        EnsureSuccess(response);
        var body = await ReadBoundedAsync(response, AppJsonContext.Default.QueueIdentity, timeout.Token);
        if (!Guid.TryParseExact(body.Id, "D", out _)) throw new InvalidDataException("The API returned no verified account identity.");
        return body.Id;
    }

    public async Task<QueueObserver> ObserverAsync(ApiConnection c, string workItemId, string executionId, string browserSessionId, CancellationToken ct)
    {
        using var timeout = Deadline(ct);
        using var request = Request(c, HttpMethod.Get, $"/api/work-queue/{Uri.EscapeDataString(workItemId)}/observer?executionId={Uri.EscapeDataString(executionId)}&browserSessionId={Uri.EscapeDataString(browserSessionId)}");
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        EnsureSuccess(response);
        return await ReadBoundedAsync(response, AppJsonContext.Default.QueueObserver, timeout.Token);
    }

    /// <summary>The saved job login, read only to hand it to the worker's own browser.</summary>
    public async Task<JsonObject?> JobLoginAsync(ApiConnection c, CancellationToken ct)
    {
        using var timeout = Deadline(ct);
        using var request = Request(c, HttpMethod.Get, "/api/credentials/resolve");
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        EnsureSuccess(response);
        return await ReadBoundedAsync(response, AppJsonContext.Default.JsonObject, timeout.Token);
    }

    public async Task<QueueRunnable> RunnableAsync(ApiConnection c, CancellationToken ct)
    {
        using var timeout = Deadline(ct);
        using var request = Request(c, HttpMethod.Get, "/api/work-queue/runnable");
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        EnsureSuccess(response);
        var result = await ReadBoundedAsync(response, AppJsonContext.Default.QueueRunnable, timeout.Token);
        if (result.ApplicationIds is null || result.AccountIds is null || result.PilotIds is null
            || result.ApplicationIds.Length > 100 || result.AccountIds.Length > 1 || result.PilotIds.Length > 1)
            throw new InvalidDataException("The runnable queue response is invalid.");
        return result;
    }

    public async Task<QueueOrder> OrderedAsync(ApiConnection c, string[] workItemIds, CancellationToken ct)
    {
        using var timeout = Deadline(ct);
        using var request = Request(c, HttpMethod.Post, "/api/work-queue/ordered");
        request.Content = JsonContent.Create(new QueueOrderRequest(workItemIds), AppJsonContext.Default.QueueOrderRequest);
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        EnsureSuccess(response);
        var result = await ReadBoundedAsync(response, AppJsonContext.Default.QueueOrder, timeout.Token);
        if (result.ServerTime == default || result.Items is null || result.Items.Length != workItemIds.Length
            || result.Items.Select(item => item.WorkItemId).Distinct().Count() != workItemIds.Length
            || !result.Items.Select(item => item.WorkItemId).ToHashSet().SetEquals(workItemIds))
            throw new InvalidDataException("The queue priority response changed the approved work set.");
        return result;
    }

    private static async Task<T> ReadBoundedAsync<T>(HttpResponseMessage response, JsonTypeInfo<T> info, CancellationToken ct)
    {
        if (response.Content.Headers.ContentLength > 1_000_000) throw new InvalidDataException("The queue response exceeded its bound.");
        using var input = await response.Content.ReadAsStreamAsync(ct);
        using var data = new MemoryStream();
        var buffer = new byte[8192];
        while (await input.ReadAsync(buffer, ct) is var count && count > 0)
        {
            if (data.Length + count > 1_000_000) throw new InvalidDataException("The queue response exceeded its bound.");
            data.Write(buffer, 0, count);
        }
        return JsonSerializer.Deserialize(data.ToArray(), info) ?? throw new InvalidDataException("The API returned no response.");
    }

    public async Task<QueueClaimResponse> ClaimAsync(ApiConnection c, QueueClaimRequest input, CancellationToken ct)
    {
        using var timeout = Deadline(ct);
        using var request = Request(c, HttpMethod.Post, "/api/work-queue/claim");
        request.Content = JsonContent.Create(input, AppJsonContext.Default.QueueClaimRequest);
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        EnsureSuccess(response);
        var envelope = await ReadBoundedAsync(response, AppJsonContext.Default.QueueClaimResponse, timeout.Token);
        if (envelope.ServerTime == default) throw new InvalidDataException("The queue response has no server clock.");
        if (envelope.Claim is { } claim)
        {
            ValidateClaim(claim);
            if (claim.Item.Id != input.WorkItemId || claim.Ownership?.RuntimeId != input.RuntimeId || claim.Ownership.WorkerId != input.WorkerId
                || claim.LeaseExpiresAt <= envelope.ServerTime) throw new InvalidDataException("The queue returned a different or expired worker claim.");
        }
        return envelope;
    }

    internal static void ValidateClaim(QueueClaim claim)
    {
        if (claim.Item is null || claim.Execution is null || !Guid.TryParse(claim.Item.Id, out _)
            || !Guid.TryParse(claim.LeaseToken, out _) || claim.Item.State != "preparing"
            || claim.Item.Kind is not ("application" or "pilot_task")
            || claim.Execution.Provider is not ("claude" or "codex")
            || string.IsNullOrWhiteSpace(claim.Execution.Prompt) || string.IsNullOrWhiteSpace(claim.Execution.Instructions))
            throw new InvalidDataException("The queue returned an invalid execution claim.");
        if (claim.Execution.ProviderSessionId is not null)
            throw new InvalidDataException("Queue work cannot resume a provider session.");
        if (claim.Item.Kind == "application" && !Guid.TryParse(claim.Item.JobId, out _))
            throw new InvalidDataException("The application work item has no owned job.");
        var owner = claim.Ownership;
        if (owner is null || !Guid.TryParse(owner.RuntimeId, out _) || !Guid.TryParse(owner.WorkerId, out _) || !Guid.TryParse(owner.ExecutionId, out _)
            || !Guid.TryParse(owner.BrowserSessionId, out _) || owner.Slot is < 1 or > 3 || claim.LeaseExpiresAt is null || claim.PolicyRevision < 1)
            throw new InvalidDataException("The queue returned no isolated worker ownership.");
        if (claim.Item.Kind == "application" && (claim.Execution.Job is not { } job || job.Id != claim.Item.JobId || !Uri.TryCreate(job.Url, UriKind.Absolute, out var url)
            || url.Scheme is not ("https" or "http") || !string.IsNullOrEmpty(url.UserInfo))) throw new InvalidDataException("The application claim has no valid owned job URL.");
        if (claim.Execution.Intent == "intake_prepare")
        {
            var preparation = claim.Execution.Preparation;
            if (claim.Item.Kind != "pilot_task" || claim.Item.JobId is not null || preparation is null
                || preparation.ApiToken != $"prep.{claim.Item.Id}.{claim.LeaseToken}")
                throw new InvalidDataException("The preparation claim has no exact narrow capability.");
            try { QueueModelGrant.ValidateSnapshot(preparation.Snapshot, claim.Item.Id, claim.Execution.Provider); }
            catch (FormatException) { throw new InvalidDataException("The preparation snapshot is invalid."); }
        }
        else if (claim.Execution.Preparation is not null) throw new InvalidDataException("The execution purpose cannot inherit a preparation capability.");
        if (claim.Execution.Intent == "account_setup")
        {
            var account = claim.Execution.AccountSetup;
            if (claim.Item.Kind != "pilot_task" || claim.Item.JobId is not null || claim.Item.CampaignId is not null || claim.Item.ApplicationId is not null || claim.Item.JobKey is not null
                || claim.Execution.Job is not null || claim.Execution.Preparation is not null
                || account is null || account.ApiToken != $"account.{claim.Item.Id}.{claim.LeaseToken}")
                throw new InvalidDataException("The account claim has no exact narrow capability.");
            try { QueueModelGrant.ValidateAccountSnapshot(account.Snapshot, claim.Item.Id, claim.Execution.Provider); }
            catch (FormatException) { throw new InvalidDataException("The account snapshot is invalid."); }
        }
        else if (claim.Execution.AccountSetup is not null) throw new InvalidDataException("The execution purpose cannot inherit an account capability.");
        if (claim.Execution.Intent == "pilot_score")
        {
            if (claim.Item.Kind != "pilot_task" || claim.Item.JobId is not null || claim.Execution.Job is not null || !ValidScorePages(claim.Execution.ScorePages))
                throw new InvalidDataException("The scoring claim has no exact list of job pages.");
        }
        else if (claim.Execution.ScorePages is not null) throw new InvalidDataException("Only pilot scoring may carry scoring pages.");
    }

    /// <summary>One to fifty distinct owned jobs, each a credential-free https page on a default port.</summary>
    internal static bool ValidScorePages(QueueScorePage[]? pages) =>
        pages is { Length: >= 1 and <= 50 }
        && pages.All(page => page is not null && Guid.TryParse(page.JobId, out _) && page.Url is { Length: <= 4000 }
            && Uri.TryCreate(page.Url, UriKind.Absolute, out var url) && url.Scheme == "https" && url.IsDefaultPort && url.UserInfo.Length == 0)
        && pages.Select(page => page.JobId).Distinct().Count() == pages.Length
        && pages.Select(page => page.Url).Distinct().Count() == pages.Length;

    public Task<WorkItem?> HeartbeatAsync(ApiConnection c, QueueClaim claim, CancellationToken ct) =>
        SendAsync(c, RunPath(claim, "/heartbeat"), JsonContent.Create(new WorkLease(claim.LeaseToken), AppJsonContext.Default.WorkLease), AppJsonContext.Default.WorkItem, ct);

    public async Task EventAsync(ApiConnection c, QueueClaim claim, WorkEvent entry, CancellationToken ct)
    {
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                await SendVoidAsync(c, RunPath(claim, "/events"), JsonContent.Create(entry, AppJsonContext.Default.WorkEvent), ct);
                return;
            }
            catch (Exception ex) when (attempt < 1 && !ct.IsCancellationRequested && IsTransient(ex))
            {
                // The event ID stays identical when the server saved it but its response was lost.
                await Task.Delay(TimeSpan.FromMilliseconds(250), ct);
            }
        }
    }

    public Task FinishAsync(ApiConnection c, QueueClaim claim, AgentResult result, CancellationToken ct) =>
        SendVoidAsync(c, RunPath(claim, "/finish"), JsonContent.Create(new WorkFinish(claim.LeaseToken, result.Status, result.Error), AppJsonContext.Default.WorkFinish), ct);

    private async Task<T?> SendAsync<T>(ApiConnection c, string path, HttpContent body, JsonTypeInfo<T> info, CancellationToken ct)
    {
        using var timeout = Deadline(ct);
        using var request = Request(c, HttpMethod.Post, path);
        request.Content = body;
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        EnsureSuccess(response);
        return await ReadBoundedAsync(response, info, timeout.Token);
    }

    private async Task SendVoidAsync(ApiConnection c, string path, HttpContent body, CancellationToken ct)
    {
        using var timeout = Deadline(ct);
        using var request = Request(c, HttpMethod.Post, path);
        request.Content = body;
        using var response = await http.SendAsync(request, timeout.Token);
        EnsureSuccess(response);
    }

    private static string RunPath(QueueClaim claim, string suffix) => $"/api/work-queue/{Uri.EscapeDataString(claim.Item.Id)}{suffix}";
    private static HttpRequestMessage Request(ApiConnection c, HttpMethod method, string path)
    {
        var request = new HttpRequestMessage(method, c.ApiUrl.TrimEnd('/') + path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", c.ApiToken);
        return request;
    }

    private static CancellationTokenSource Deadline(CancellationToken ct)
    {
        var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(10));
        return timeout;
    }

    private static void EnsureSuccess(HttpResponseMessage response)
    {
        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException($"Queue API rejected the request ({(int)response.StatusCode}).", null, response.StatusCode);
    }

    private static bool IsTransient(Exception error) => error is OperationCanceledException
        || error is HttpRequestException { StatusCode: null or >= System.Net.HttpStatusCode.InternalServerError };
}
