namespace JobPilot.Terminal.Common;

/// <summary>A retry delay that doubles from <paramref name="initial"/> up to <paramref name="max"/> until <see cref="Reset"/>.</summary>
internal struct ExponentialBackoff(TimeSpan initial, TimeSpan max)
{
    private int failures;

    public TimeSpan Next()
    {
        var seconds = Math.Min(initial.TotalSeconds * Math.Pow(2, failures), max.TotalSeconds);
        failures++;
        return TimeSpan.FromSeconds(seconds);
    }

    public void Reset() => failures = 0;
}
