using System.Runtime.InteropServices;
using System.Text.Json;
using JobPilot.Terminal.Hosting;
using Xunit;

namespace JobPilot.Terminal.Tests;

public sealed class HostRuntimeTests
{
    [Theory]
    [InlineData("windows", Architecture.X64, "wsl", "development")]
    [InlineData("macos", Architecture.Arm64, "lima", "beta-unvalidated")]
    [InlineData("macos", Architecture.X64, "lima", "beta-unvalidated")]
    [InlineData("windows", Architecture.Arm64, "none", "unsupported")]
    [InlineData("other", Architecture.X64, "none", "unsupported")]
    public void SelectsOnlySupportedBackends(string platform, Architecture arch, string backend, string support)
    {
        var result = HostRuntime.Describe(platform, arch);
        Assert.Equal(backend, result.Backend);
        Assert.Equal(support, result.Support);
        Assert.Equal(arch.ToString().ToLowerInvariant(), result.Architecture);
    }

    [Fact]
    public void RuntimeHasAotSerializationMetadata()
    {
        var json = JsonSerializer.Serialize(HostRuntime.Describe("macos", Architecture.Arm64), AppJsonContext.Default.HostRuntime);
        Assert.Contains("\"platform\":\"macos\"", json);
        Assert.Contains("\"support\":\"beta-unvalidated\"", json);
    }
}
