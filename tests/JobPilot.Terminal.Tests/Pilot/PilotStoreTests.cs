using JobPilot.Terminal.Pilot;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace JobPilot.Terminal.Tests;

public sealed class PilotStoreTests : IDisposable
{
    private readonly TempDir temp = new();
    private readonly string path;

    public PilotStoreTests()
    {
        path = Path.Combine(temp.Root, "pilot.json");
    }

    public void Dispose() => temp.Dispose();

    private PilotStore NewStore() => new(path, NullLogger<PilotStore>.Instance);

    private static PilotSettings SavedSettings(bool running = true) => new()
    {
        Provider = "codex",
        ApiToken = "secret-token",
        ApiUrl = "https://api.example",
        WebUrl = "https://web.example",
        Running = running,
    };

    [Fact]
    public void Current_IsNull_WhenNoFileExists()
    {
        Assert.Null(NewStore().Current);
    }

    [Fact]
    public void Save_RoundTripsThroughAFreshStore()
    {
        NewStore().Save(SavedSettings());

        var reloaded = NewStore().Current;

        Assert.NotNull(reloaded);
        Assert.Equal("codex", reloaded!.Provider);
        Assert.Equal("secret-token", reloaded.ApiToken);
        Assert.Equal("https://api.example", reloaded.ApiUrl);
        Assert.Equal("https://web.example", reloaded.WebUrl);
        Assert.True(reloaded.Running);
    }

    [Fact]
    public void SetRunning_KeepsTheRest_AndPersists()
    {
        var store = NewStore();
        store.Save(SavedSettings());

        store.SetRunning(false);

        Assert.False(store.Current!.Running);
        Assert.Equal("secret-token", store.Current.ApiToken);
        Assert.False(NewStore().Current!.Running); // survived a reload
    }

    [Fact]
    public void Changed_IsRaisedOnlyWhenSomethingChanged()
    {
        var store = NewStore();
        var changes = 0;
        store.Changed += () => changes++;

        store.SetRunning(false); // nothing saved yet
        store.Save(SavedSettings());
        store.SetRunning(true);  // already running
        store.SetRunning(false);

        Assert.Equal(2, changes);
    }

    [Fact]
    public void SetRunning_IsANoOp_WhenNothingIsSaved()
    {
        var store = NewStore();

        store.SetRunning(false);

        Assert.Null(store.Current);
        Assert.False(File.Exists(path));
    }

    [Fact]
    public void Load_TreatsACorruptFileAsNothingSaved()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, "{ this is not valid json ");

        Assert.Null(NewStore().Current);
    }

    [Fact]
    public void Save_DoesNotStoreTheRawTokenOnWindows()
    {
        if (!OperatingSystem.IsWindows())
        {
            return;
        }

        NewStore().Save(SavedSettings());

        Assert.DoesNotContain("secret-token", File.ReadAllText(path));
    }

    [Fact]
    public void Save_RestrictsFilePermissionsOffWindows()
    {
        if (OperatingSystem.IsWindows())
        {
            return;
        }

        NewStore().Save(SavedSettings());

        var mode = File.GetUnixFileMode(path);
        Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, mode);
    }

    [Fact]
    public void Save_ReplacesTheFile_WithoutLeavingTemporaryFiles()
    {
        var store = NewStore();
        store.Save(SavedSettings());

        store.Save(SavedSettings(running: false));

        Assert.False(NewStore().Current!.Running);
        Assert.Empty(Directory.EnumerateFiles(temp.Root, ".pilot.json.*.tmp"));
    }
}
