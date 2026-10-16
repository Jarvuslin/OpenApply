namespace OpenApply.Terminal.Agent;

/// <summary>The legacy PTY and queue executor share one browser, so they must never run together.</summary>
public sealed class AgentRuntimeGate
{
    private readonly Lock sync = new();
    private string? owner;

    public bool QueueOwnsRuntime { get { lock (sync) return owner == "queue"; } }
    public bool BrowserReserved { get { lock (sync) return owner is not null and not "legacy"; } }

    public bool TryAcquireLegacy()
    {
        lock (sync)
        {
            if (owner is not null and not "legacy") return false;
            owner = "legacy";
            return true;
        }
    }

    public bool TryAcquireQueue()
    {
        lock (sync)
        {
            if (owner is not null) return false;
            owner = "queue";
            return true;
        }
    }

    public void ReleaseLegacy() { lock (sync) { if (owner == "legacy") owner = null; } }
    public void ReleaseQueue() { lock (sync) { if (owner == "queue") owner = null; } }
    public bool TryAcquireQuestions() { lock (sync) { if (owner is not null) return false; owner = "questions"; return true; } }
    public void ReleaseQuestions() { lock (sync) { if (owner == "questions") owner = null; } }
    public bool TryAcquirePreparation() { lock (sync) { if (owner is not null) return false; owner = "preparation"; return true; } }
    public void ReleasePreparation() { lock (sync) { if (owner == "preparation") owner = null; } }
}
