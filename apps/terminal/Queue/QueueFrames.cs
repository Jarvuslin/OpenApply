using System.Text.Json;
using System.Text.Json.Nodes;
using OpenApply.Terminal.Agent;

namespace OpenApply.Terminal.Queue;

internal sealed partial class QueueRuntime
{
    internal async Task<QueueFrame> FrameAsync(string browserSessionId, string workItemId, string executionId, string token, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > 16000 || token.Any(char.IsControl))
            throw new InvalidOperationException("An authenticated viewer is required.");
        Worker worker;
        ApiConnection settings;
        string expectedOwner;
        lock (sync)
        {
            if (connection is null || ownerId is null || !workers.TryGetValue(browserSessionId, out var found)
                || found.Browser is null || found.State != "running" || found.Stop.IsCancellationRequested
                || found.Claim.Item.Id != workItemId || found.Claim.Ownership!.ExecutionId != executionId)
                throw new InvalidOperationException("The owned worker is unavailable.");
            worker = found; settings = connection with { ApiToken = token }; expectedOwner = ownerId;
        }
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(TimeSpan.FromSeconds(5));
        var observation = await api.ObserverAsync(settings, workItemId, executionId, browserSessionId, deadline.Token);
        ValidateObserver(observation, expectedOwner, workItemId, executionId, browserSessionId);
        var session = worker.Browser!;
        await session.FrameOperation.WaitAsync(deadline.Token);
        try
        {
            EnsureCurrent();
            var cached = session.LastFrame;
            if (cached is not null && DateTimeOffset.UtcNow - cached.CapturedAt < TimeSpan.FromSeconds(1)) return cached;
            var response = await session.SendAsync(new JsonObject
            {
                ["action"] = "frame",
                ["workItemId"] = workItemId,
                ["executionId"] = executionId,
                ["browserSessionId"] = browserSessionId
            }, deadline.Token);
            var frame = response.Deserialize(AppJsonContext.Default.QueueFrame) ?? throw new InvalidDataException("No browser frame was returned.");
            ValidateFrame(frame, workItemId, executionId, browserSessionId);
            EnsureCurrent();
            session.LastFrame = frame;
            return frame;
        }
        finally { session.FrameOperation.Release(); }

        void EnsureCurrent()
        {
            ValidateObserver(observation, expectedOwner, workItemId, executionId, browserSessionId);
            lock (sync)
                if (connection is null || connection.ApiUrl != settings.ApiUrl || ownerId != expectedOwner
                    || !workers.TryGetValue(browserSessionId, out var current) || current != worker
                    || worker.State != "running" || worker.Stop.IsCancellationRequested)
                    throw new InvalidOperationException("The owned worker is no longer available.");
        }
    }

    internal static void ValidateObserver(QueueObserver observation, string ownerId, string workItemId, string executionId, string browserSessionId)
    {
        if (!observation.Active || observation.OwnerId != ownerId || observation.WorkItemId != workItemId
            || observation.ExecutionId != executionId || observation.BrowserSessionId != browserSessionId
            || observation.CurrentExecutionId != executionId
            || observation.State is not ("preparing" or "ready" or "filling") || observation.LeaseExpiresAt is null
            || observation.LeaseExpiresAt <= DateTimeOffset.UtcNow)
            throw new InvalidOperationException("The authenticated worker lease is unavailable.");
    }

    internal static void ValidateFrame(QueueFrame frame, string workItemId, string executionId, string browserSessionId)
    {
        if (frame.WorkItemId != workItemId || frame.ExecutionId != executionId || frame.BrowserSessionId != browserSessionId
            || frame.CapturedAt < DateTimeOffset.UtcNow.AddSeconds(-5) || frame.CapturedAt > DateTimeOffset.UtcNow.AddSeconds(1)
            || frame.MimeType != "image/jpeg" || frame.Width is < 1 or > 1920 || frame.Height is < 1 or > 1080
            || frame.ImageBase64 is not { Length: > 0 and <= 853336 }) throw new InvalidDataException("The browser frame is invalid or stale.");
        byte[] bytes;
        try { bytes = Convert.FromBase64String(frame.ImageBase64); }
        catch (FormatException) { throw new InvalidDataException("The browser frame is invalid."); }
        if (bytes.Length is < 4 or > 640000 || bytes[0] != 255 || bytes[1] != 216 || bytes[^2] != 255 || bytes[^1] != 217)
            throw new InvalidDataException("The browser frame is invalid or too large.");
    }
}
