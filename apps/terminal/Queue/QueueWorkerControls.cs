using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using OpenApply.Terminal.Agent;
using OpenApply.Terminal.Preparation;

namespace OpenApply.Terminal.Queue;

internal sealed partial class QueueRuntime
{
    internal async Task<JsonObject> ControlAsync(string browserSessionId, string capability, string action, CancellationToken ct)
    {
        Worker worker;
        ApiConnection settings;
        lock (sync)
        {
            if (!workers.TryGetValue(browserSessionId, out var found) || found.Browser is null || found.State != "running" || found.Stop.IsCancellationRequested
                || connection is null || capability.Length != 64 || !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(capability), Encoding.UTF8.GetBytes(found.Browser.Capability)))
                throw new InvalidOperationException("The worker browser is not owned by this request.");
            worker = found; settings = connection;
            if (worker.Claim.Execution.AccountSetup is not null) throw new InvalidOperationException("Account work never exposes application browser controls.");
            if (worker.Claim.Execution.Preparation is not null ? action != "inspect" : action == "inspect")
                throw new InvalidOperationException("This browser command is outside its execution purpose.");
        }
        var session = worker.Browser!;
        using var stop = CancellationTokenSource.CreateLinkedTokenSource(ct, worker.Stop.Token);
        await session.Operation.WaitAsync(stop.Token);
        try
        {
            var state = await api.HeartbeatAsync(settings, worker.Claim, stop.Token);
            if (state?.State is not ("preparing" or "ready" or "filling") || state.CancellationRequestedAt is not null || state.PauseRequestedAt is not null || state.LeaseExpiresAt is null)
                throw new InvalidOperationException("The browser lease is no longer active.");
            await session.RenewAsync(state.LeaseExpiresAt.Value, stop.Token);
            if (action == "inspect") return await session.SendAsync(new() { ["action"] = "inspect" }, stop.Token);
            if (action == "attach") return new() { ["browserSessionId"] = browserSessionId, ["port"] = session.Port, ["outputDir"] = session.OutputDirectory };
            if (action == "login") return await SignInAsync(settings, session, stop.Token);
            // Sites without pre-fill start released; the agent fills the form itself.
            if (session.Released && session.PreparedHash is null && action is ("prepare" or "handoff")) return new() { ["released"] = true, ["prepared"] = false };
            using var preparationApi = new PreparationApi(new HttpClient(new SocketsHttpHandler { AllowAutoRedirect = false }) { Timeout = Timeout.InfiniteTimeSpan }, worker.Claim.Item.Id, worker.Claim.LeaseToken);
            var request = new PreparationRequest(settings.ApiToken, settings.ApiUrl, worker.Claim.Item.JobId!, Guid.NewGuid().ToString(), 0, "");
            var manifest = await preparationApi.ReadAsync(request, stop.Token);
            if (manifest.Job.Id != worker.Claim.Item.JobId || manifest.Job.Url != worker.Claim.Execution.Job!.Url || manifest.Mode != "worker" || manifest.SubmissionAllowed)
                throw new InvalidDataException("The manifest does not match the owned browser job.");
            request = request with { ExpectedCollectionVersion = manifest.CollectionVersion, ManifestHash = manifest.ManifestHash };
            if (action == "prepare")
            {
                if (session.PreparedHash is not null || session.Released) throw new InvalidOperationException("Preparation may run only once in this owned browser.");
                var runtime = new PreparationRuntime(preparationApi, new OwnedPreparationBrowser(session), gate);
                var result = await runtime.FillWorkerAsync(request, stop.Token);
                session.PreparedHash = manifest.ManifestHash;
                return JsonSerializer.SerializeToNode(result, AppJsonContext.Default.PreparationResult) as JsonObject ?? throw new InvalidDataException();
            }
            if (action == "handoff")
            {
                if (session.Released || session.PreparedHash is null || manifest.ManifestHash != session.PreparedHash)
                    throw new InvalidOperationException("Preparation changed or was not retained. Review this work item before continuing.");
                var result = await session.SendAsync(new() { ["action"] = "handoff", ["manifestHash"] = session.PreparedHash }, stop.Token);
                session.Released = true;
                return result;
            }
            throw new ArgumentException("Unknown worker browser command.");
        }
        catch
        {
            grant!.Cancel("An owned browser control failed; all approved workers stopped for review.");
            throw;
        }
        finally { session.Operation.Release(); }
    }

    /// <summary>Fills the saved job login into the worker's sign-in form; the password never reaches the model.</summary>
    private async Task<JsonObject> SignInAsync(ApiConnection settings, QueueBrowserSession session, CancellationToken ct)
    {
        // A sign-in problem is reported to the worker, never a reason to stop every running worker.
        if (!session.Released) return new() { ["signedIn"] = false, ["reason"] = "browser_not_released" };
        JsonObject? login;
        try { login = await api.JobLoginAsync(settings, ct); }
        catch (Exception ex) when (ex is HttpRequestException or InvalidDataException or JsonException) { login = null; }
        if (login?["email"]?.GetValue<string>() is not { Length: > 0 } email || login["password"]?.GetValue<string>() is not { Length: > 0 } password)
            return new() { ["signedIn"] = false, ["reason"] = "no_saved_login" };
        try { return await session.SendAsync(new() { ["action"] = "login", ["email"] = email, ["password"] = password }, ct); }
        catch (InvalidOperationException ex)
        {
            logger.LogWarning("Worker sign-in failed: {Reason}", ex.Message);
            return new() { ["signedIn"] = false, ["reason"] = "sign_in_failed" };
        }
    }

    private sealed class OwnedPreparationBrowser(QueueBrowserSession session) : IPreparationBrowser
    {
        public async Task<PreparationObservation> FillAsync(PreparationBrowserRequest request, CancellationToken ct)
        {
            var config = JsonSerializer.SerializeToNode(request, AppJsonContext.Default.PreparationBrowserRequest);
            var response = await session.SendAsync(new() { ["action"] = "prepare", ["config"] = config }, ct);
            return response.Deserialize(AppJsonContext.Default.PreparationObservation) ?? throw new InvalidDataException("The owned browser returned no preparation evidence.");
        }
    }
}
