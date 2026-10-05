using System.Runtime.InteropServices;
using CpuArchitecture = System.Runtime.InteropServices.Architecture;

namespace JobPilot.Terminal.Hosting;

public sealed record HostRuntime(string Platform, string Architecture, string Backend, string Support)
{
    public static HostRuntime Current()
    {
        var platform = "other";
        if (OperatingSystem.IsWindows()) platform = "windows";
        if (OperatingSystem.IsMacOS()) platform = "macos";
        return Describe(platform, RuntimeInformation.OSArchitecture);
    }

    internal static HostRuntime Describe(string platform, CpuArchitecture architecture)
    {
        var arch = architecture.ToString().ToLowerInvariant();
        if (platform == "windows" && architecture == CpuArchitecture.X64)
            return new(platform, arch, "wsl", "development");
        if (platform == "macos" && architecture is CpuArchitecture.Arm64 or CpuArchitecture.X64)
            return new(platform, arch, "lima", "beta-unvalidated");
        return new(platform, arch, "none", "unsupported");
    }
}
