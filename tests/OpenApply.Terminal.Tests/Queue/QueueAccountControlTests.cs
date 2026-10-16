using System.Text.Json;
using System.Text.Json.Nodes;
using OpenApply.Terminal.Agent;
using OpenApply.Terminal.Queue;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed partial class QueuePoolTests
{
    private sealed class AccountApi : IAccountBrokerApi
    {
        internal AccountSetupSnapshot Snapshot = null!;
        internal string Phase = "signup_ready";
        internal string Purpose = "signup";
        internal int Attempts;
        internal bool MailboxBlocked;
        internal string? Reason;
        internal readonly List<JsonObject> Observations = [];
        internal readonly List<string> Calls = [];
        internal JsonObject Context() => new()
        {
            ["snapshot"] = JsonSerializer.SerializeToNode(Snapshot, AppJsonContext.Default.AccountSetupSnapshot),
            ["attempt"] = new JsonObject { ["phase"] = Phase, ["signupAttempts"] = Attempts, ["existingAccount"] = Purpose == "existing", ["credentialPurpose"] = Purpose,
                ["currentUrl"] = Snapshot.SignupUrl, ["mailboxBlocked"] = MailboxBlocked, ["reason"] = Reason },
        };
        public Task<JsonObject> CallAsync(ApiConnection connection, string action, JsonObject? input, CancellationToken ct)
        {
            Assert.StartsWith("account.", connection.ApiToken);
            Calls.Add(action);
            if (action == "observe")
            {
                Observations.Add((JsonObject)input!.DeepClone());
                if (input["event"]?.GetValue<string>() == "mailbox_status") { MailboxBlocked = true; Phase = "needs_user"; Reason = "mailbox_identity"; }
            }
            if (action == "begin") { Attempts++; Phase = "signup_started"; }
            if (action == "credential") return Task.FromResult(new JsonObject { ["credentialId"] = Snapshot.CredentialId, ["email"] = Snapshot.Email, ["password"] = "synthetic-private" });
            return Task.FromResult(Context());
        }
    }

    [Fact]
    public async Task KnownMailboxFailureIsSavedBeforeHumanHandoffWithoutMailboxContents()
    {
        using var evidence = new TempDir();
        var account = new AccountApi { Phase = "verification_pending" };
        using var test = new Pool(account: true, accountBroker: account);
        account.Snapshot = test.Api.Account!;
        test.Browser.WorkspaceRoot = evidence.Root;
        test.Browser.OnCommand = command =>
        {
            Assert.True(command["context"]!["attempt"]!["mailboxBlocked"]!.GetValue<bool>());
            Assert.Equal("request_help", command["operation"]!.GetValue<string>());
            return new() { ["phase"] = "needs_user", ["observation"] = new JsonObject
            {
                ["event"] = "needs_user", ["reason"] = "mailbox_identity", ["currentUrl"] = account.Snapshot.SignupUrl,
                ["browserSessionId"] = Path.GetFileName(Assert.Single(test.Process.Started).Browser!.Workspace),
            } };
        };
        await test.Start();
        await TestWait.Until(() => test.Process.Started.Count == 1);
        var request = Assert.Single(test.Process.Started);
        var directory = Path.Combine(request.Browser!.Workspace, "account-provider");
        Directory.CreateDirectory(directory);
        File.WriteAllText(Path.Combine(directory, "tool-state.json"), JsonSerializer.Serialize(new AccountToolState
        {
            Snapshot = account.Snapshot, Blocked = true, MailboxFailure = "mismatch", ObservedMailbox = "other@example.test",
        }, AppJsonContext.Default.AccountToolState));
        await test.Runtime.AccountControlAsync(Path.GetFileName(request.Browser.Workspace), request.Browser.Capability, new("request_help", new() { ["reason"] = "mailbox_identity" }), TestContext.Current.CancellationToken);
        var observation = Assert.Single(account.Observations);
        Assert.Equal("mailbox_status", observation["event"]!.GetValue<string>());
        Assert.Equal("mismatch", observation["status"]!.GetValue<string>());
        Assert.Equal("other@example.test", observation["email"]!.GetValue<string>());
        Assert.Equal(5, observation.Count);
        Assert.Equal(["context", "observe"], account.Calls);
        test.Process.Complete.TrySetResult(new("waiting", UsageKnown: true));
        await TestWait.Until(() => test.Api.Finishes == 1 && !test.Runtime.Status.Running);
        await test.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task SignupReservesBeforeFetchingCredentialForBrokerOnlyAndRunsOnce()
    {
        var account = new AccountApi();
        using var test = new Pool(account: true, accountBroker: account);
        account.Snapshot = test.Api.Account!;
        test.Browser.OnCommand = command =>
        {
            Assert.Equal("signup", command["operation"]!.GetValue<string>());
            Assert.Equal(1, account.Attempts);
            Assert.Equal("synthetic-private", command["credential"]!["password"]!.GetValue<string>());
            return new() { ["phase"] = "verification" };
        };
        await test.Start();
        await TestWait.Until(() => test.Process.Started.Count == 1);
        var request = Assert.Single(test.Process.Started);
        var result = await test.Runtime.AccountControlAsync(request.Browser!.Workspace, request.Browser.Capability, new("signup", new()), TestContext.Current.CancellationToken);
        Assert.Equal("verification", result["phase"]!.GetValue<string>());
        Assert.DoesNotContain("synthetic-private", result.ToJsonString());
        Assert.Equal(["context", "begin", "credential"], account.Calls);
        await Assert.ThrowsAsync<InvalidOperationException>(() => test.Runtime.AccountControlAsync(request.Browser.Workspace, request.Browser.Capability, new("signup", new()), TestContext.Current.CancellationToken));
        Assert.Equal(1, account.Attempts);
        await test.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task ExistingLoginCredentialRemainsOnHostBrokerStdinAndIsNotReturnedToModel()
    {
        var account = new AccountApi { Phase = "checking", Purpose = "existing" };
        using var test = new Pool(account: true, accountBroker: account);
        account.Snapshot = test.Api.Account!;
        test.Browser.OnCommand = command =>
        {
            Assert.Equal("synthetic-private", command["credential"]!["password"]!.GetValue<string>());
            return new() { ["phase"] = "authenticated" };
        };
        await test.Start();
        await TestWait.Until(() => test.Process.Started.Count == 1);
        var request = Assert.Single(test.Process.Started);
        var result = await test.Runtime.AccountControlAsync(request.Browser!.Workspace, request.Browser.Capability, new("login", new()), TestContext.Current.CancellationToken);
        Assert.Equal(["context", "credential"], account.Calls);
        Assert.DoesNotContain("synthetic-private", result.ToJsonString());
        await Assert.ThrowsAsync<InvalidOperationException>(() => test.Runtime.AccountControlAsync(request.Browser.Workspace, request.Browser.Capability, new("login", new()), TestContext.Current.CancellationToken));
        Assert.Single(account.Calls, value => value == "credential");
        test.Process.Complete.TrySetResult(new("completed", UsageKnown: true));
        await test.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }
}
