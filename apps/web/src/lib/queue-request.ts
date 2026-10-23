import { z } from "zod/v4";

type RequestStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function createQueueRequestStore(storage: RequestStorage) {
  const memory = new Map<string, string | null>();
  const storageKey = (key: string) => `openapply:queue-request:${key}`;
  return {
    read(key: string): string | null {
      if (memory.has(key)) return memory.get(key) ?? null;
      try {
        const parsed = z.uuid().safeParse(storage.getItem(storageKey(key)));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
    write(key: string, id: string): void {
      memory.set(key, id);
      try {
        storage.setItem(storageKey(key), id);
      } catch {
        // Retain the same request in this tab if browser storage is unavailable.
      }
    },
    clear(key: string): void {
      memory.set(key, null);
      try {
        storage.removeItem(storageKey(key));
      } catch {
        // Confirmed memory state takes precedence over an old saved request.
      }
    },
  };
}

export async function sendQueueRequest<T>(
  store: ReturnType<typeof createQueueRequestStore>,
  accountId: string,
  scope: unknown,
  send: (idempotencyKey: string) => Promise<T>,
  createId: () => string = () => crypto.randomUUID(),
): Promise<T> {
  if (!accountId) throw new Error("Sign in before adding work to your queue.");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify([accountId, scope])),
  );
  const key = Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  const id = store.read(key) ?? createId();
  store.write(key, id);
  const result = await send(id);
  store.clear(key);
  return result;
}

export const queueRequests = createQueueRequestStore({
  getItem: (key) => sessionStorage.getItem(key),
  setItem: (key, value) => sessionStorage.setItem(key, value),
  removeItem: (key) => sessionStorage.removeItem(key),
});
