using System.Diagnostics;
using System.Text.Json.Nodes;
using OpenApply.Terminal.Queue;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed class QueueBrowserTransportTests
{
    [Fact]
    public async Task BoundedLineProtocolKeepsInputOpenForRenewalAndClosesOnEof()
    {
        if (!OperatingSystem.IsWindows()) return;
        var start = new ProcessStartInfo("powershell.exe") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        start.ArgumentList.Add("-NoProfile"); start.ArgumentList.Add("-NonInteractive"); start.ArgumentList.Add("-Command");
        start.ArgumentList.Add("[Console]::WriteLine('{\"ready\":true}'); while ($null -ne ($line = [Console]::ReadLine())) { $message = $line | ConvertFrom-Json; @{requestId=$message.requestId;ok=$true;result=@{renewed=$true}} | ConvertTo-Json -Compress | ForEach-Object { [Console]::WriteLine($_) } }");
        var transport = new QueueBrowserTransport(start);
        try
        {
            await transport.StartAsync(TestContext.Current.CancellationToken);
            var results = await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => transport.SendAsync(new JsonObject { ["action"] = "renew", ["ttlMs"] = 1000 }, TestContext.Current.CancellationToken)));
            Assert.All(results, result => Assert.True(result["renewed"]!.GetValue<bool>()));
        }
        finally { await transport.CloseAsync(); }
    }
}
