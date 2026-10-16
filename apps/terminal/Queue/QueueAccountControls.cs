using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace OpenApply.Terminal.Queue;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed record AccountControlRequest(string Operation, JsonObject Input);

internal sealed partial class QueueRuntime
{
    internal static readonly string[] AccountOperations = ["inspect", "signup", "login", "verification_context", "verify", "request_help"];
    private readonly IAccountBrokerApi accountBrokerApi = accountApi ?? new AccountBrokerApi();

    internal async Task<JsonObject> AccountControlAsync(string browserSessionId, string capability, AccountControlRequest input, CancellationToken ct)
    {
        if (!AccountOperations.Contains(input.Operation) || input.Input is null || input.Input.ToJsonString().Length > 16000)
            throw new InvalidOperationException("Unknown account operation.");
        Worker worker;
        OpenApply.Terminal.Agent.ApiConnection settings;
        lock (sync)
        {
            if (connection is null || !workers.TryGetValue(browserSessionId, out var found) || found.Claim.Execution.AccountSetup is null
                || found.Browser is null || found.State != "running" || found.Stop.IsCancellationRequested || capability.Length != 64
                || !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(capability), Encoding.UTF8.GetBytes(found.Browser.Capability)))
                throw new InvalidOperationException("Account browser ownership could not be verified.");
            worker = found;
            settings = connection with { ApiToken = found.Claim.Execution.AccountSetup.ApiToken };
        }
        var session = worker.Browser!;
        using var stop = CancellationTokenSource.CreateLinkedTokenSource(ct, worker.Stop.Token);
        await session.Operation.WaitAsync(stop.Token);
        try
        {
            var context = await accountBrokerApi.CallAsync(settings, "context", null, stop.Token);
            ValidateAccountContext(context, worker.Claim.Execution.AccountSetup!.Snapshot);
            context = await PersistAccountMailboxFailureAsync(settings, worker, context, stop.Token) ?? context;
            var attempt = context["attempt"] as JsonObject ?? throw new InvalidDataException("Missing account attempt.");
            if (attempt["mailboxBlocked"]?.GetValue<bool>() == true && input.Operation != "request_help")
                throw new InvalidOperationException("The connected mailbox needs human review before account work can continue.");
            JsonObject? credential = null;
            if (input.Operation == "signup")
            {
                if (worker.Claim.Execution.AccountSetup.Snapshot.Operation != "signup" || attempt["phase"]?.GetValue<string>() != "signup_ready"
                    || attempt["signupAttempts"]?.GetValue<int>() != 0 || !worker.AccountMutations.Add("signup"))
                    throw new InvalidOperationException("Signup is not available for this account attempt.");
                context = await accountBrokerApi.CallAsync(settings, "begin", new(), stop.Token);
                ValidateAccountContext(context, worker.Claim.Execution.AccountSetup.Snapshot);
                credential = await AccountCredentialAsync(settings, worker.Claim.Execution.AccountSetup.Snapshot, stop.Token);
            }
            if (input.Operation == "login")
            {
                if (attempt["phase"]?.GetValue<string>() != "checking" || attempt["existingAccount"]?.GetValue<bool>() != true
                    || attempt["credentialPurpose"]?.GetValue<string>() != "existing" || !worker.AccountMutations.Add("login"))
                    throw new InvalidOperationException("Only a human-saved existing login may be used.");
                credential = await AccountCredentialAsync(settings, worker.Claim.Execution.AccountSetup.Snapshot, stop.Token);
            }
            var command = new JsonObject { ["action"] = "account", ["operation"] = input.Operation, ["input"] = input.Input.DeepClone(), ["context"] = context.DeepClone() };
            if (credential is not null) command["credential"] = credential;
            if (input.Operation == "verify" && (attempt["phase"]?.GetValue<string>() != "verification_pending" || !worker.AccountMutations.Add("verify")))
                throw new InvalidOperationException("Only the current verification may be attempted once.");
            var response = await session.SendAsync(command, stop.Token);
            command.Remove("credential");
            if (response.Remove("observation", out var observation) && observation is not null)
            {
                var observations = observation is JsonArray array ? array.ToArray() : [observation];
                foreach (var entry in observations)
                {
                    if (entry is not JsonObject body || body["browserSessionId"]?.GetValue<string>() != browserSessionId)
                        throw new InvalidDataException("Account observation changed browser ownership.");
                    if (body["event"]?.GetValue<string>() == "needs_user" && context["attempt"]?["phase"]?.GetValue<string>() == "needs_user"
                        && body["reason"]?.GetValue<string>() == context["attempt"]?["reason"]?.GetValue<string>()) continue;
                    var updated = await accountBrokerApi.CallAsync(settings, "observe", body, stop.Token);
                    ValidateAccountContext(updated, worker.Claim.Execution.AccountSetup.Snapshot);
                    context = updated;
                }
            }
            if (response.ToJsonString().Length > 64000) throw new InvalidDataException("Account observation exceeded its bound.");
            return response;
        }
        catch (Exception ex)
        {
            // Links are dropped from the reason: an activation URL carries a one-time token.
            logger.LogWarning("Account operation {Operation} failed ({FailureType}: {Reason}).", input.Operation, ex.GetType().Name,
                System.Text.RegularExpressions.Regex.Replace(ex.Message, @"https?://\S+", "[link]"));
            grant!.Cancel("The account operation stopped; inspect its saved state before any continuation.");
            throw;
        }
        finally { session.Operation.Release(); }
    }
    private async Task<JsonObject> AccountCredentialAsync(OpenApply.Terminal.Agent.ApiConnection settings, AccountSetupSnapshot snapshot, CancellationToken ct)
    {
        var credential = await accountBrokerApi.CallAsync(settings, "credential", null, ct);
        if (credential["credentialId"]?.GetValue<string>() != snapshot.CredentialId || credential["email"]?.GetValue<string>() != snapshot.Email)
            throw new InvalidDataException("Account credentials changed.");
        return credential;
    }
    internal static void ValidateAccountContext(JsonObject context, AccountSetupSnapshot expected)
    {
        var snapshot = context["snapshot"]?.Deserialize(AppJsonContext.Default.AccountSetupSnapshot);
        if (snapshot != expected) throw new InvalidDataException("The account snapshot changed.");
    }

    private async Task<OpenApply.Terminal.Agent.AgentResult> AccountCompletionAsync(OpenApply.Terminal.Agent.ApiConnection settings, Worker worker,
        OpenApply.Terminal.Agent.AgentResult result, CancellationToken ct)
    {
        var context = await accountBrokerApi.CallAsync(settings, "context", null, ct);
        ValidateAccountContext(context, worker.Claim.Execution.AccountSetup!.Snapshot);
        context = await PersistAccountMailboxFailureAsync(settings, worker, context, ct) ?? context;
        if (!result.UsageKnown || result.Status is not ("completed" or "waiting")) return result;
        return context["attempt"]?["phase"]?.GetValue<string>() switch
        {
            "authenticated" => result with { Status = "completed", Error = null },
            "needs_user" or "verification_pending" or "unknown" => result with { Status = "waiting", Error = null },
            _ => result with { Status = "failed", Error = "Account authentication or a saved human handoff was not observed." },
        };
    }

    private async Task<JsonObject?> PersistAccountMailboxFailureAsync(OpenApply.Terminal.Agent.ApiConnection settings, Worker worker, JsonObject? context, CancellationToken ct)
    {
        var snapshot = worker.Claim.Execution.AccountSetup?.Snapshot;
        if (snapshot is null || worker.Browser is null) return context;
        var path = Path.Combine(worker.Browser.Workspace, "account-provider", "tool-state.json");
        if (!File.Exists(path)) return context;
        using var file = File.OpenRead(path);
        if (file.Length > 131072) throw new InvalidDataException("Account tool state exceeded its bound.");
        var state = JsonSerializer.Deserialize(file, AppJsonContext.Default.AccountToolState) ?? throw new InvalidDataException("Missing account tool state.");
        if (state.Snapshot != snapshot) throw new InvalidDataException("Account tool state changed snapshot.");
        if (state.MailboxFailure is not ("mismatch" or "authorization_failed")) return context;
        context ??= await accountBrokerApi.CallAsync(settings, "context", null, ct);
        ValidateAccountContext(context, snapshot);
        if (context["attempt"]?["mailboxBlocked"]?.GetValue<bool>() == true) return context;
        var currentUrl = context["attempt"]?["currentUrl"]?.GetValue<string>();
        if (currentUrl is null) throw new InvalidDataException("Mailbox failure has no observed account page.");
        var updated = await accountBrokerApi.CallAsync(settings, "observe", new()
        {
            ["event"] = "mailbox_status", ["status"] = state.MailboxFailure,
            ["email"] = state.ObservedMailbox ?? snapshot.Email, ["browserSessionId"] = worker.Claim.Ownership!.BrowserSessionId,
            ["currentUrl"] = currentUrl,
        }, ct);
        ValidateAccountContext(updated, snapshot);
        return updated;
    }
}
