import type { TransportLocks } from "./shared-transport";

/** Race both FIFO queues so free capacity is usable regardless of a stream's URL. */
export async function withConnectionSlot(
  locks: TransportLocks,
  origin: string,
  signal: AbortSignal,
  run: (slot: string) => Promise<void>,
) {
  const contenders = [new AbortController(), new AbortController()];
  let chosen = false;
  const attempts = contenders.map((controller, index) => {
    const slot = `openapply:sse:v2:${origin}:slot:${index}`;
    return locks.request(
      slot,
      { signal: AbortSignal.any([signal, controller.signal]) },
      async () => {
        if (chosen || signal.aborted) return;
        chosen = true;
        for (const other of contenders) if (other !== controller) other.abort();
        await run(slot);
      },
    );
  });
  const results = await Promise.allSettled(attempts);
  signal.throwIfAborted();
  for (const [index, result] of results.entries()) {
    if (
      result.status === "rejected" &&
      !(contenders[index]?.signal.aborted && result.reason?.name === "AbortError")
    )
      throw result.reason;
  }
}
