using System.Diagnostics;
using System.Text.Json;
using OpenApply.Terminal.Agent;
using OpenApply.Terminal.Queue;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed class QueueContextTests
{
    [Fact]
    public void ApplicationContextCarriesOnlyTheLease()
    {
        var request = new AgentRequest("work-id", "private-lease", "claude", "Apply to the owned job", "Instructions", null);
        var start = new ProcessStartInfo();
        AgentProcess.SetWorkEnvironment(start, request);
        Assert.Equal("work-id", start.Environment["OPENAPPLY_WORK_ITEM_ID"]);
        Assert.Equal("private-lease", start.Environment["OPENAPPLY_WORK_LEASE_TOKEN"]);
        Assert.Empty(start.ArgumentList);
    }

    [Fact]
    public void EventRedactsCredentialsAcrossContentSessionAndMetadata()
    {
        var claim = QueueApiTests.Claim with { LeaseToken = "private-lease" };
        var entry = new AgentEvent("text", "top-secret private-lease password=secret", "top-secret", Metadata:
            new WorkEventMetadata("private-lease", SkillName: "top-secret", SubagentType: "safe-worker"));
        var result = QueueRedaction.Event(claim, entry, "top-secret");
        Assert.DoesNotContain("top-secret", result.Content);
        Assert.DoesNotContain("private-lease", result.Content);
        Assert.DoesNotContain("password=secret", result.Content);
        Assert.Null(result.ProviderSessionId);
        Assert.Null(result.Metadata!.ToolName);
        Assert.Null(result.Metadata.SkillName);
        Assert.Equal("safe-worker", result.Metadata.SubagentType);
        // The authorization token is sent only in the lease field, never in the persisted event fields.
        Assert.Equal("private-lease", result.LeaseToken);
    }

    [Fact]
    public void MalformedOrMixedClaimsCannotSelectOrPrepareAProvider()
    {
        var valid = QueueGrantTests.Claim(QueueApiTests.ClaimInput);
        QueueApi.ValidateClaim(valid);
        Assert.Throws<InvalidDataException>(() => QueueApi.ValidateClaim(valid with { Execution = valid.Execution with { Provider = "" } }));
        Assert.Throws<InvalidDataException>(() => QueueApi.ValidateClaim(valid with { Execution = valid.Execution with { ProviderSessionId = "old-session" } }));
        Assert.Throws<InvalidDataException>(() => QueueApi.ValidateClaim(valid with { Item = valid.Item with { Kind = "unknown" } }));
        Assert.Throws<InvalidDataException>(() => QueueApi.ValidateClaim(valid with { Item = valid.Item with { JobId = null } }));
        Assert.Throws<InvalidDataException>(() => QueueApi.ValidateClaim(valid with { LeaseToken = "" }));
    }

    [Fact]
    public void QueueStatusCannotExposeConnectionOrLeaseCredentials()
    {
        var json = JsonSerializer.Serialize(new QueueStatus(true, false, "Model execution is disabled by the host budget.", null), AppJsonContext.Default.QueueStatus);
        Assert.DoesNotContain("token", json, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("blockingReason", json);
    }
}
