using System.Security.Cryptography;
using System.Text.RegularExpressions;
using OpenApply.Terminal.Agent;
using OpenApply.Terminal.Queue;
using Xunit;

namespace OpenApply.Terminal.Tests;

public sealed partial class QueuePoolTests
{
    [Fact]
    public async Task RealShippedPluginGetsIndependentCapsBeforeFakeExecutionWithoutSourceChangesOrReplay()
    {
        using var test = new Pool(shippedPlugin: true);
        var original = Files(test.PluginDir);
        Assert.Equal(2, Directory.GetFiles(Path.Combine(test.PluginDir, "agents"), "*.md").Length);
        Assert.All(Directory.GetFiles(Path.Combine(test.PluginDir, "agents"), "*.md"), file => Assert.DoesNotContain("maxTurns:", File.ReadAllText(file)));
        Assert.Throws<ModelBudgetException>(() => ModelBudgetTests.Budget("unused").ValidatePlugin(test.PluginDir));
        await test.Start();
        await TestWait.Until(() => test.Process.Started.Count == 3);
        Assert.Equal(3, test.Process.Started.Select(request => request.PluginStage!.PluginDir).Distinct().Count());
        foreach (var request in test.Process.Started)
        {
            request.PluginStage!.Verify(request.Budget!);
            Assert.Equal(request.WorkItemId, request.Budget!.UsageContext!.WorkItemId);
            Assert.NotNull(request.Budget.UsageContext.ExecutionId);
            Assert.Equal(request.PluginStage.SourceHash, request.Budget.UsageContext.PluginSourceHash);
            foreach (var file in Directory.GetFiles(Path.Combine(request.PluginStage.PluginDir, "agents"), "*.md"))
            {
                var staged = File.ReadAllText(file);
                Assert.Contains($"maxTurns: {request.Budget.MaxWorkerTurns}", staged);
                var restored = Regex.Replace(staged, @"\nmaxTurns: \d+(?=\r?\n---)", "");
                Assert.Equal(File.ReadAllText(Path.Combine(test.PluginDir, "agents", Path.GetFileName(file))), restored);
            }
        }
        Assert.Equal(original, Files(test.PluginDir));
        test.Process.Complete.TrySetResult(new("completed", UsageKnown: true));
        await TestWait.Until(() => test.Api.Finishes == 3 && !test.Runtime.Status.Running);
        await Task.Delay(350, TestContext.Current.CancellationToken);
        Assert.Equal(3, test.Api.Claims);
        Assert.True(File.Exists(test.ApprovalPath + ".used"));
        await test.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }

    [Theory]
    [InlineData("model: opus")]
    [InlineData("model: opus # unsupported model")]
    [InlineData("maxTurns: invalid")]
    [InlineData("maxTurns: 2\nmaxTurns: 3")]
    public async Task InvalidShippedPluginConsumesNoApprovalClaimBrowserOrModel(string header)
    {
        using var test = new Pool(shippedPlugin: true);
        var worker = Path.Combine(test.PluginDir, "agents", "resume-reviewer.md");
        File.WriteAllText(worker, File.ReadAllText(worker).Replace("name: resume-reviewer", "name: resume-reviewer\n" + header));
        await test.Start();
        await TestWait.Until(() => test.Runtime.Status.LastError is not null);
        Assert.Equal(0, test.Api.Claims);
        Assert.Equal(0, test.Browser.Closed);
        Assert.Equal(0, test.Browser.Started);
        Assert.Empty(test.Process.Started);
        Assert.False(File.Exists(test.ApprovalPath + ".used"));
        Assert.Equal(3, test.Runtime.Status.Budget!.RemainingAllocations);
        await test.Runtime.StopAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public void SnapshotTamperingFailsClosedAndExistingStricterCapsAreRetained()
    {
        using var temp = new TempDir();
        var source = Path.Combine(temp.Root, "source");
        Directory.CreateDirectory(Path.Combine(source, "agents"));
        Directory.CreateDirectory(Path.Combine(source, "settings"));
        File.WriteAllText(Path.Combine(source, "settings", "claude.json"), "{\"model\":\"sonnet\"}");
        File.WriteAllText(Path.Combine(source, "agents", "worker.md"), "---\nname: worker\nmaxTurns: 2\nmodel: inherit\n---\nPrivate synthetic body");
        var budget = ModelBudgetTests.Budget("unused");
        var stage = QueuePluginStage.Create(source, Path.Combine(temp.Root, "staging"), budget);
        Assert.Contains("maxTurns: 2", File.ReadAllText(Path.Combine(stage.PluginDir, "agents", "worker.md")));
        File.AppendAllText(Path.Combine(stage.PluginDir, "agents", "worker.md"), "changed");
        Assert.Throws<ModelBudgetException>(() => stage.Verify(budget));
    }

    private static string[] Files(string directory) => Directory.GetFiles(directory, "*", SearchOption.AllDirectories)
        .Select(file => Path.GetRelativePath(directory, file) + ":" + Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(file)))).Order().ToArray();
}
