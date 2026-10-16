using System.Text.Json;
using System.Text.Json.Nodes;
using OpenApply.Terminal.Agent;
using OpenApply.Terminal.Queue;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed class QueueAccountTests
{
    internal static AccountSetupSnapshot Snapshot(string? id = null) => new(2, 1, "signup", new('a', 64), "account_setup", id ?? Guid.NewGuid().ToString(), "claude",
        "https://synthetic.example/careers", "https://synthetic.example", Guid.NewGuid().ToString(), "synthetic@example.test", "unknown", 1, false, new('b', 64));

    internal static string WriteApproval(string root)
    {
        var path = QueueGrantTests.WriteApproval(root, 1);
        var value = JsonSerializer.Deserialize(File.ReadAllText(path), AppJsonContext.Default.QueueGrantFile)!;
        var allocation = value.Allocations[0];
        value = value with { Purpose = "queue-account-setup", MaxConcurrentWorkers = 1, Budget = value.Budget with { MaxSubagents = 0 },
            Allocations = [allocation with { Budget = allocation.Budget with { MaxSubagents = 0 }, AccountSetup = Snapshot(allocation.WorkItemId) }] };
        File.WriteAllText(path, JsonSerializer.Serialize(value, AppJsonContext.Default.QueueGrantFile));
        return path;
    }

    [Fact]
    public void AccountGrantBindsPurposeSnapshotAndSingleUseWithoutApplicationFields()
    {
        using var temp = new TempDir();
        var path = WriteApproval(temp.Root);
        var bytes = File.ReadAllBytes(path);
        Assert.Throws<ModelBudgetException>(() => QueueModelGrant.Validate(bytes, DateTimeOffset.UtcNow));
        var grant = QueueModelGrant.Read(key => key == QueueModelGrant.AccountEnvironmentKey ? path : null, Path.Combine(temp.Root, "evidence"), DateTimeOffset.UtcNow)!;
        Assert.True(grant.IsAccountSetup);
        void Invalid(QueueGrantFile value) => Assert.Throws<ModelBudgetException>(() => QueueModelGrant.Validate(JsonSerializer.SerializeToUtf8Bytes(value, AppJsonContext.Default.QueueGrantFile), DateTimeOffset.UtcNow, account: true));
        Invalid(grant.Approval with { MaxConcurrentWorkers = 2 });
        Invalid(grant.Approval with { Budget = grant.Approval.Budget with { MaxSubagents = 1 } });
        Invalid(grant.Approval with { Allocations = [grant.Approval.Allocations[0] with { AccountSetup = Snapshot() }] });
        grant.Activate(DateTimeOffset.UtcNow);
        var allocation = grant.Reserve()!;
        grant.Launch(allocation);
        grant.Finish(allocation);
        Assert.Throws<ModelBudgetException>(() => grant.Launch(allocation));
    }

    [Fact]
    public void AccountSnapshotRejectsTenantAliasesScopeEscapesAndUnknownFields()
    {
        var snapshot = Snapshot();
        QueueModelGrant.ValidateAccountSnapshot(snapshot, snapshot.WorkItemId, "claude");
        foreach (var changed in new[] { snapshot with { SignupUrl = "https://another.example/careers" }, snapshot with { SubmissionAllowed = true },
            snapshot with { TenantOrigin = "https://synthetic.example." }, snapshot with { MaxSignupAttempts = 2 }, snapshot with { CredentialRevision = "wrong" }, snapshot with { Revision = 0 } })
            Assert.Throws<FormatException>(() => QueueModelGrant.ValidateAccountSnapshot(changed, snapshot.WorkItemId, "claude"));
        var raw = (JsonObject)JsonSerializer.SerializeToNode(snapshot, AppJsonContext.Default.AccountSetupSnapshot)!;
        raw["resumeId"] = Guid.NewGuid().ToString();
        Assert.Throws<JsonException>(() => raw.Deserialize(AppJsonContext.Default.AccountSetupSnapshot));
    }

    [Fact]
    public void GrantWithADuplicateKeyIsRejected()
    {
        using var temp = new TempDir();
        var text = File.ReadAllText(WriteApproval(temp.Root));
        var duplicated = text.Replace("\"maxConcurrentWorkers\":1", "\"maxConcurrentWorkers\":1,\"maxConcurrentWorkers\":1");
        Assert.NotEqual(text, duplicated);
        QueueModelGrant.Validate(System.Text.Encoding.UTF8.GetBytes(text), DateTimeOffset.UtcNow, account: true);
        Assert.Throws<ModelBudgetException>(() => QueueModelGrant.Validate(System.Text.Encoding.UTF8.GetBytes(duplicated), DateTimeOffset.UtcNow, account: true));
    }

    [Fact]
    public void ClaimRoundTripPreservesAccountCapabilityAndRejectsApplicationContamination()
    {
        var snapshot = Snapshot();
        var request = new QueueClaimRequest(Guid.NewGuid().ToString(), Guid.NewGuid().ToString(), Guid.NewGuid().ToString(), snapshot.WorkItemId, new(AccountSetup: true), AccountSnapshotHash: snapshot.SnapshotHash);
        var claim = QueueGrantTests.Claim(request, 1);
        claim = claim with { Item = claim.Item with { Kind = "pilot_task", JobId = null }, Execution = claim.Execution with { Intent = "account_setup", Job = null, AccountSetup = new(snapshot, $"account.{claim.Item.Id}.{claim.LeaseToken}") } };
        var serialized = JsonSerializer.Serialize(claim, AppJsonContext.Default.QueueClaim);
        var actual = JsonSerializer.Deserialize(serialized, AppJsonContext.Default.QueueClaim)!;
        Assert.Equal(snapshot, actual.Execution.AccountSetup!.Snapshot);
        QueueApi.ValidateClaim(actual);
        Assert.Throws<InvalidDataException>(() => QueueApi.ValidateClaim(actual with { Item = actual.Item with { CampaignId = Guid.NewGuid().ToString() } }));
        Assert.Throws<InvalidDataException>(() => QueueApi.ValidateClaim(actual with { Execution = actual.Execution with { Intent = null } }));
        Assert.Throws<InvalidDataException>(() => QueueApi.ValidateClaim(actual with { Execution = actual.Execution with { AccountSetup = new(snapshot, "ordinary-token") } }));
        var result = QueueRedaction.Event(actual, new("text", "password=synthetic-private; mailbox body and verification code 123456"), "ordinary-token");
        Assert.DoesNotContain("private", result.Content);
        Assert.DoesNotContain("123456", result.Content);
        Assert.Null(result.Metadata);
    }
}

public sealed partial class QueuePoolTests
{
    [Fact]
    public async Task AccountRuntimeDispatchesScopedTokenAndDeniesEveryApplicationControl()
    {
        using var test = new Pool(account: true);
        await test.Start();
        await TestWait.Until(() => test.Process.Started.Count == 1);
        var request = Assert.Single(test.Process.Started);
        Assert.Equal(test.Api.Account, request.AccountSetup);
        Assert.Null(request.Preparation);
        Assert.Equal($"account.{request.WorkItemId}.{request.LeaseToken}", Assert.Single(test.Process.Connections).ApiToken);
        foreach (var action in new[] { "attach", "prepare", "handoff", "inspect" })
            await Assert.ThrowsAsync<InvalidOperationException>(() => test.Runtime.ControlAsync(request.Browser!.Workspace, request.Browser.Capability, action, TestContext.Current.CancellationToken));
        test.Process.Complete.TrySetResult(new("completed", UsageKnown: true));
        await TestWait.Until(() => test.Api.Finishes == 1 && test.Browser.Closed == 1);
        Assert.Equal(1, test.Api.Claims);
        await test.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task CompletedProviderTurnWithCanonicalNeedsUserRetainsRestrictedHandoffAndClosesOnDisconnect()
    {
        using var test = new Pool(account: true);
        test.Account.Phase = "needs_user";
        await test.Start();
        await TestWait.Until(() => test.Process.Started.Count == 1);
        var request = Assert.Single(test.Process.Started);
        test.Process.Complete.TrySetResult(new("completed", UsageKnown: true));
        await TestWait.Until(() => test.Api.Finishes == 1 && !test.Runtime.Status.Running);
        var status = await test.Runtime.AccountHandoffAsync(request.WorkItemId, "viewer-only", TestContext.Current.CancellationToken);
        Assert.True(status.Available);
        Assert.Equal("waiting", Assert.Single(test.Api.Results).Status);
        Assert.Equal("http://localhost:6080/vnc.html", status.ViewerUrl);
        Assert.Equal(0, test.Browser.Closed);
        Assert.True(test.Gate.QueueOwnsRuntime);
        test.Runtime.Disconnect();
        await TestWait.Until(() => test.Browser.Closed == 1);
        await test.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task CompletedProviderTurnCannotInventAnAuthenticatedAccount()
    {
        using var test = new Pool(account: true);
        test.Account.Phase = "checking";
        await test.Start();
        await TestWait.Until(() => test.Process.Started.Count == 1);
        test.Process.Complete.TrySetResult(new("completed", UsageKnown: true));
        await TestWait.Until(() => test.Api.Finishes == 1 && !test.Runtime.Status.Running);
        Assert.Equal("failed", Assert.Single(test.Api.Results).Status);
        Assert.Equal(1, test.Browser.Closed);
        await test.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }
}
