using System.Text.Json;
using Microsoft.AspNetCore.Http;
using OpenApply.Terminal.Queue;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed class AccountSetupPreflightTests
{
    [Fact]
    public void IsolatedAccountWorkerCanLaunchWithoutClaimingLiveMailboxVerification()
    {
        var context = new DefaultHttpContext();
        var result = AccountSetupPreflight.Readiness(context);
        var readiness = Assert.IsType<AccountSetupReadiness>(Assert.IsAssignableFrom<IValueHttpResult>(result).Value);

        Assert.True(readiness.Ready);
        Assert.True(readiness.ModelFree);
        Assert.Equal(0, readiness.ModelRequests);
        Assert.True(readiness.Capabilities.AccountWorkerIsolationSupported);
        Assert.Equal("unverified", readiness.Capabilities.WorkerGmailProfileAvailability);
        Assert.False(readiness.Capabilities.WorkerGmailIdentityVerified);
        Assert.False(readiness.Capabilities.GmailProfileRequired);
        Assert.False(readiness.Capabilities.WorkerGmailAccessVerified);
        Assert.Empty(readiness.Blockers);
        Assert.Contains(readiness.Limitations!, value => value.Contains("user handoff"));
        Assert.Equal("no-store", context.Response.Headers.CacheControl);
    }

    [Fact]
    public void CallerClaimsCannotEnableExecutionOrExposeCredentialsInReadiness()
    {
        var context = new DefaultHttpContext();
        context.Request.QueryString = new("?ready=true&accountWorkerIsolationSupported=true&workerGmailIdentityVerified=true&workerGmailAccessVerified=true&mailboxConfirmed=true&email=synthetic%40example.test&password=synthetic-secret");
        context.Request.Headers.Authorization = "Bearer synthetic-token";
        var result = AccountSetupPreflight.Readiness(context);
        var readiness = Assert.IsType<AccountSetupReadiness>(Assert.IsAssignableFrom<IValueHttpResult>(result).Value);
        var json = JsonSerializer.Serialize(readiness, AppJsonContext.Default.AccountSetupReadiness);

        Assert.True(readiness.Ready);
        Assert.True(readiness.Capabilities.AccountWorkerIsolationSupported);
        Assert.False(readiness.Capabilities.WorkerGmailIdentityVerified);
        Assert.False(readiness.Capabilities.WorkerGmailAccessVerified);
        Assert.DoesNotContain("synthetic", json);
        Assert.Contains("\"modelRequests\":0", json);
        Assert.Contains("\"workerGmailProfileAvailability\":\"unverified\"", json);
        Assert.Contains("\"gmailProfileRequired\":false", json);
    }
}
