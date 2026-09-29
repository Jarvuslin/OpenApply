using JobPilot.Terminal.Providers;
using System.Text.Json;
using JobPilot.Terminal.Contracts;
using JobPilot.Terminal.Pilot;
using JobPilot.Terminal.Sessions;
using Xunit;

namespace JobPilot.Terminal.Tests;

public class AppJsonContextTests
{
    [Fact]
    public void BrowserMessage_ReadsTheEnvelopesTheBrowserSends()
    {
        var input = JsonSerializer.Deserialize("""{"type":"input","data":"aGk="}""", AppJsonContext.Default.BrowserMessage);
        var resize = JsonSerializer.Deserialize("""{"type":"resize","cols":120,"rows":40}""", AppJsonContext.Default.BrowserMessage);
        var partial = JsonSerializer.Deserialize("""{"type":"resize"}""", AppJsonContext.Default.BrowserMessage);

        Assert.Equal(new BrowserMessage("input", "aGk=", null, null), input);
        Assert.Equal(new BrowserMessage("resize", null, 120, 40), resize);
        Assert.Equal(new BrowserMessage("resize", null, null, null), partial);
    }

    [Fact]
    public void SessionStatus_SerializesCamelCase_ThroughTheContextsOwnOptions()
    {
        var json = JsonSerializer.Serialize(
            new SessionStatus
            {
                Status = "ok",
                Session = "stopped",
                Provider = "claude",
                Providers = [new ProviderInfo("claude", "Claude Code")],
                HostVersion = "2.0.8",
                CanRelaunch = true,
                CanUpdate = false,
            },
            AppJsonContext.Default.SessionStatus);

        Assert.Contains("\"hostVersion\":\"2.0.8\"", json);
        Assert.Contains("\"canRelaunch\":true", json);
        Assert.Contains("\"displayName\":\"Claude Code\"", json);
        Assert.DoesNotContain("HostVersion", json);
    }

    [Fact]
    public void ProblemDetails_SerializesTheLowercaseFieldsTheWebReads()
    {
        var json = JsonSerializer.Serialize(
            new Microsoft.AspNetCore.Mvc.ProblemDetails { Title = "t", Detail = "d", Status = 500 },
            AppJsonContext.Default.ProblemDetails);

        Assert.Contains("\"detail\":\"d\"", json);
        Assert.Contains("\"title\":\"t\"", json);
    }
}
