using OpenApply.Terminal.Pilot;
using OpenApply.Terminal.Providers;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace OpenApply.Terminal.Tests;

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
        Provider = Provider.Codex,
        ApiToken = "secret-token",
        ApiUrl = "https://api.example",
        WebUrl = "https://web.example",
        Running = running,
    };

    [Fact]
    public void Save_RoundTripsThroughAFreshStore()
    {
        NewStore().Save(SavedSettings());

        var reloaded = NewStore().Current;

        Assert.NotNull(reloaded);
        Assert.Same(Provider.Codex, reloaded!.Provider);
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
        Assert.Null(store.Current);
        Assert.False(File.Exists(path));

        store.Save(SavedSettings());
        store.SetRunning(true);  // already running
        store.SetRunning(false);

        Assert.Equal(2, changes);
    }

    [Theory]
    [InlineData("{ this is not valid json ")]
    [InlineData("""{"provider":"gemini","token":"t","protected":false,"apiUrl":"https://a","webUrl":"https://w","running":true}""")]
    public void Load_TreatsACorruptFileOrUnknownProviderAsNothingSaved(string json)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, json);

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
