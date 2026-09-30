using System.Net.ServerSentEvents;
using System.Text.Json;
using JobPilot.Terminal.Common;
using Microsoft.Extensions.Hosting;

namespace JobPilot.Terminal.Pilot;

/// <summary>The event type is in the JSON, not the SSE event name.</summary>
internal sealed record PilotEvent(string? Type, PilotEventPromotion? Promotion, PilotEventState? State);

internal sealed record PilotEventPromotion(string? Status);

internal sealed record PilotEventState(bool? Running);

/// <summary>Holds the pilot event stream open while the pilot runs, and wakes the loop on events that unblock a cycle.</summary>
public sealed class PilotEventListener(PilotStore store, PilotApi api, Action wake, ILogger<PilotEventListener> logger)
    : BackgroundService
{
    private static readonly TimeSpan InitialBackoff = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan MaxBackoff = TimeSpan.FromMinutes(5);

    internal static bool ShouldWake(PilotEvent e) => e.Type switch
    {
        "question.answered" or "state.changed" => true,
        "promotion.updated" => e.Promotion?.Status == "approved",
        _ => false,
    };

    internal static bool IsRemoteStop(PilotEvent e) => e.Type == "state.changed" && e.State?.Running == false;

    internal static PilotEvent? Parse(string data)
    {
        // Control frames (connected, ping) carry no data.
        if (string.IsNullOrEmpty(data))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize(data, AppJsonContext.Default.PilotEvent);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var backoff = new ExponentialBackoff(InitialBackoff, MaxBackoff);
        while (!stoppingToken.IsCancellationRequested)
        {
            // Any settings change cancels this pass, so the stream never outlives the credentials it opened with.
            using var changed = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
            void OnChanged() => changed.Cancel();
            store.Changed += OnChanged;
            try
            {
                // Read after subscribing, so a change in between still cancels this pass.
                if (store.Current is not { Running: true } settings)
                {
                    await Task.Delay(Timeout.Infinite, changed.Token);
                    continue;
                }

                var connected = await StreamAsync(settings, changed.Token);
                if (connected)
                {
                    backoff.Reset();
                }

                await Task.Delay(connected ? InitialBackoff : backoff.Next(), changed.Token);
            }
            catch (OperationCanceledException) when (!stoppingToken.IsCancellationRequested)
            {
                backoff.Reset();
            }
            catch (OperationCanceledException)
            {
                return;
            }
            finally
            {
                store.Changed -= OnChanged;
            }
        }
    }

    /// <summary>Pumps events until the stream ends. Returns whether the server accepted the connection.</summary>
    private async Task<bool> StreamAsync(PilotSettings settings, CancellationToken ct)
    {
        var connected = false;
        try
        {
            using var response = await api.OpenEventsAsync(settings, ct);
            if (response is null)
            {
                return false;
            }

            connected = true;
            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            await foreach (var item in SseParser.Create(stream).EnumerateAsync(ct))
            {
                Handle(item.Data);
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogDebug(ex, "Pilot event stream dropped; will reconnect.");
        }

        return connected;
    }

    private void Handle(string data)
    {
        if (Parse(data) is not { } e)
        {
            return;
        }

        // A stop from another device reaches this host only here. Mirror it before waking, or the loop re-reads
        // Running=true and keeps starting cycles.
        if (IsRemoteStop(e))
        {
            store.SetRunning(false);
        }

        if (ShouldWake(e))
        {
            wake();
        }
    }
}
