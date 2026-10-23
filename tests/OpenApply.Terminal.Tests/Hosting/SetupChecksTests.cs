using OpenApply.Terminal.Hosting;
using Xunit;

namespace OpenApply.Terminal.Tests;

public class SetupChecksTests
{
    private const string DoctorJson = """{"checks":[{"id":"git","label":"Git","status":"ok","required":true,"detail":"git 2","fix":""}]}""";

    [Fact]
    public async Task GetAsync_WithoutTheLauncherScript_ExplainsInsteadOfRunning()
    {
        using var temp = new TempDir();
        var runs = 0;
        var checks = new SetupChecks(temp.Root, (_, _) => { runs++; return Task.FromResult<string?>(DoctorJson); });

        var result = await checks.GetAsync(CancellationToken.None);

        Assert.Null(result.Json);
        Assert.Contains("source checkout", result.Error);
        Assert.Equal(0, runs);
    }

    [Fact]
    public async Task GetAsync_SharesOneRunInsideTheCacheWindow()
    {
        using var temp = new TempDir();
        temp.File(Path.Combine("scripts", "openapply.mjs"), "");
        var runs = 0;
        var checks = new SetupChecks(temp.Root, (root, _) =>
        {
            Assert.Equal(temp.Root, root);
            runs++;
            return Task.FromResult<string?>(DoctorJson);
        });

        var first = await checks.GetAsync(CancellationToken.None);
        var second = await checks.GetAsync(CancellationToken.None);

        Assert.Equal(1, runs);
        Assert.Equal(first, second);
        Assert.Contains("\"checks\"", first.Json);
    }

    [Fact]
    public async Task GetAsync_DoesNotCacheAFailedRun()
    {
        using var temp = new TempDir();
        temp.File(Path.Combine("scripts", "openapply.mjs"), "");
        var outputs = new Queue<string?>([null, DoctorJson]);
        var checks = new SetupChecks(temp.Root, (_, _) => Task.FromResult(outputs.Dequeue()));

        Assert.NotNull((await checks.GetAsync(CancellationToken.None)).Error);
        Assert.NotNull((await checks.GetAsync(CancellationToken.None)).Json);
    }

    [Theory]
    [InlineData("")]
    [InlineData("not json")]
    [InlineData("""{"status":"ok"}""")]
    [InlineData("""[1,2]""")]
    public void Parse_RejectsOutputWithoutAChecksArray(string output)
    {
        var result = SetupChecks.Parse(output);

        Assert.Null(result.Json);
        Assert.NotNull(result.Error);
    }
}
