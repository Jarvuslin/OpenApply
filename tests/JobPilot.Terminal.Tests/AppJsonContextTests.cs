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
    public void PilotActivityResponse_DeserializesTheLastCycleTheServerSends()
    {
        var response = JsonSerializer.Deserialize(
            """{"lastActivityAt":"2026-07-19T18:34:43Z","lastCycle":{"cycleId":"1f2e3d4c-5b6a-7089-90ab-cdef01234567","completedAt":"2026-07-19T18:30:00Z","status":"empty","sleepSeconds":3600}}""",
            AppJsonContext.Default.PilotActivityResponse);

        Assert.NotNull(response);
        Assert.Equal(new DateTimeOffset(2026, 7, 19, 18, 34, 43, TimeSpan.Zero), response!.LastActivityAt);
        Assert.NotNull(response.LastCycle);
        Assert.Equal("1f2e3d4c-5b6a-7089-90ab-cdef01234567", response.LastCycle!.CycleId);
        Assert.Equal("empty", response.LastCycle.Status);
        Assert.Equal(3600, response.LastCycle.SleepSeconds);
    }

    [Fact]
    public void PilotActivityResponse_LeavesLastCycleNull_WhenTheUserHasNoCompletedCycleYet()
    {
        var response = JsonSerializer.Deserialize(
            """{"lastActivityAt":null,"lastCycle":null}""", AppJsonContext.Default.PilotActivityResponse);

        Assert.NotNull(response);
        Assert.Null(response!.LastActivityAt);
        Assert.Null(response.LastCycle);
    }

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
