using JobPilot.Terminal.Updates;
using Xunit;

namespace JobPilot.Terminal.Tests;

public class GitHubReleaseClientTests
{
    private static GitHubRelease Release(string? tag) => new(tag, Assets: null);

    [Fact]
    public void SelectLatestAbove_ReturnsNull_WhenAllReleasesAreOlderOrEqual()
    {
        var releases = new[] { Release("v1.0.0"), Release("v2.0.8") };
        Assert.Null(GitHubReleaseClient.SelectLatestAbove(releases, new Version(2, 0, 8)));
    }

    [Fact]
    public void SelectLatestAbove_PicksHighestVersion_NotListOrder()
    {
        var releases = new[] { Release("v2.1.0"), Release("v3.0.0"), Release("v2.9.9") };

        var latest = GitHubReleaseClient.SelectLatestAbove(releases, new Version(2, 0, 8));

        Assert.NotNull(latest);
        Assert.Equal(new Version(3, 0, 0), latest!.Value.Version);
    }

    [Fact]
    public void SelectLatestAbove_IgnoresTagsWithoutTheVPrefix()
    {
        var releases = new[] { Release("plugin-9.9.9"), Release("9.9.9"), Release("v2.1.0") };

        var latest = GitHubReleaseClient.SelectLatestAbove(releases, new Version(2, 0, 8));

        Assert.NotNull(latest);
        Assert.Equal(new Version(2, 1, 0), latest!.Value.Version);
    }

    [Fact]
    public void SelectLatestAbove_IgnoresUnparsableAndNullTags()
    {
        var releases = new[] { Release(null), Release("vNext"), Release("v"), Release("v2.1.0") };

        var latest = GitHubReleaseClient.SelectLatestAbove(releases, new Version(2, 0, 8));

        Assert.NotNull(latest);
        Assert.Equal(new Version(2, 1, 0), latest!.Value.Version);
    }

    [Fact]
    public void SelectLatestAbove_ReturnsNull_WhenNoReleases()
    {
        Assert.Null(GitHubReleaseClient.SelectLatestAbove([], new Version(2, 0, 8)));
    }

    [Fact]
    public void SelectLatestAbove_TreatsAHigherPatchAsAnUpdate()
    {
        var latest = GitHubReleaseClient.SelectLatestAbove([Release("v2.0.9")], new Version(2, 0, 8));

        Assert.NotNull(latest);
        Assert.Equal("v2.0.9", latest!.Value.Release.TagName);
    }

}
