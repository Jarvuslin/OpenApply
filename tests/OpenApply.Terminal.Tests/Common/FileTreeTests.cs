using OpenApply.Terminal.Common;
using Xunit;

namespace OpenApply.Terminal.Tests;

public class FileTreeTests
{
    [Fact]
    public void Copy_OverwritesExistingFiles_AndAddsNewOnes()
    {
        using var temp = new TempDir();
        temp.File(Path.Combine("target", "openapply.exe"), "old binary");
        temp.File(Path.Combine("source", "openapply.exe"), "new binary");
        temp.File(Path.Combine("source", "plugin", "skills", "new-skill.md"), "fresh");
        var target = Path.Combine(temp.Root, "target");

        FileTree.Copy(Path.Combine(temp.Root, "source"), target);

        Assert.Equal("new binary", File.ReadAllText(Path.Combine(target, "openapply.exe")));
        Assert.Equal("fresh", File.ReadAllText(Path.Combine(target, "plugin", "skills", "new-skill.md")));
    }
}
