using Microsoft.AspNetCore.Http;
using OpenApply.Terminal.Hosting;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed class BudgetedHostTests
{
    [Theory]
    [InlineData("/inference")]
    [InlineData("/sessions/start")]
    [InlineData("/ws")]
    [InlineData("/pilot/start")]
    [InlineData("/connectors/gmail/check")]
    [InlineData("/update")]
    [InlineData("/INFERENCE/")]
    public async Task IsolatedHostBlocksEveryUnbudgetedModelEntrypoint(string path)
    {
        var context = new DefaultHttpContext();
        context.Response.Body = new MemoryStream();
        context.Request.Path = path;
        var called = false;
        await BudgetedHost.RejectOtherEntrypoints(_ => { called = true; return Task.CompletedTask; }, true)(context);
        Assert.False(called);
        Assert.Equal(403, context.Response.StatusCode);
    }

    [Theory]
    [InlineData("/healthz", true)]
    [InlineData("/queue/connect", true)]
    [InlineData("/queue/status", true)]
    [InlineData("/shutdown", true)]
    [InlineData("/sessions/start", false)]
    public async Task AllowedEntrypointsRemainAvailable(string path, bool isolated)
    {
        var context = new DefaultHttpContext();
        context.Request.Path = path;
        var called = false;
        await BudgetedHost.RejectOtherEntrypoints(_ => { called = true; return Task.CompletedTask; }, isolated)(context);
        Assert.True(called);
    }
}
