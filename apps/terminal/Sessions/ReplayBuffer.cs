namespace JobPilot.Terminal.Sessions;

/// <summary>
/// Bounded byte-size FIFO of session output chunks, replayed to newly connected clients so a reload
/// restores the screen. Not thread-safe: the hub guards it with its registration lock.
/// </summary>
internal sealed class ReplayBuffer(int capacityBytes)
{
    private readonly Queue<byte[]> chunks = new();
    private int bytes;

    /// <summary>Buffered chunks, oldest first.</summary>
    public IReadOnlyCollection<byte[]> Chunks => chunks;

    /// <summary>Appends a chunk, evicting the oldest ones beyond the byte capacity.</summary>
    public void Append(byte[] data)
    {
        while (bytes + data.Length > capacityBytes && chunks.Count > 0)
        {
            bytes -= chunks.Dequeue().Length;
        }
        chunks.Enqueue(data);
        bytes += data.Length;
    }

    public void Clear()
    {
        chunks.Clear();
        bytes = 0;
    }
}
