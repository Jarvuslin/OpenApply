using OpenApply.Terminal.Inference;
using System.Text.Json;
using Xunit;

namespace OpenApply.Terminal.Tests;

public class InferenceTests
{
    [Fact]
    public void ExtractionCannotLoadUserToolsOrReuseAnInteractiveSession()
    {
        var claude = InferenceEndpoints.Arguments("claude", "haiku", "result.txt");
        Assert.Contains("--no-session-persistence", claude);
        Assert.Equal("", claude[Array.IndexOf(claude, "--tools") + 1]);
        Assert.Contains("--strict-mcp-config", claude);
        Assert.Contains("haiku", claude);
        var codex = InferenceEndpoints.Arguments("codex", "default", "result.txt");
        Assert.Contains("--ignore-user-config", codex);
        Assert.Contains("--ephemeral", codex);
        Assert.Contains("read-only", codex);
        Assert.DoesNotContain("--dangerously-bypass-approvals-and-sandbox", codex);
    }

    [Fact]
    public void AotCanSerializeInferenceRequestsAndResponses()
    {
        var request = new InferenceRequest("claude", null, "haiku", true);
        var json = JsonSerializer.Serialize(request, AppJsonContext.Default.InferenceRequest);
        Assert.Equal(request, JsonSerializer.Deserialize(json, AppJsonContext.Default.InferenceRequest));
        Assert.Contains("OPENAPPLY_READY", JsonSerializer.Serialize(new InferenceResponse("claude", "haiku", "OPENAPPLY_READY"), AppJsonContext.Default.InferenceResponse));
    }
}
