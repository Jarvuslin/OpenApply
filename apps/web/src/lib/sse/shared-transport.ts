import { withConnectionSlot } from "./connection-slots";

export type ConnectionStatus = "idle" | "connecting" | "waiting" | "open" | "reconnecting";

export interface StreamMessage {
  data: string;
  lastEventId: string;
  origin: string;
}

export interface StreamSource {
  readonly readyState: number;
  readonly CLOSED: number;
  onmessage: ((event: StreamMessage) => void) | null;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  close(): void;
}

export interface TransportChannel {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(value: unknown): void;
  close(): void;
}

export interface TransportLocks {
  request(
    name: string,
    options: { signal: AbortSignal },
    callback: () => Promise<void>,
  ): Promise<void>;
  query(): Promise<{ pending?: { name?: string }[] }>;
}

export interface TransportPlatform {
  scope: string;
  locks: TransportLocks;
  channel(name: string): TransportChannel;
  open(url: string, lastEventId: string): StreamSource;
  leaseMs?: number;
}

export interface StreamListener {
  message(event: StreamMessage): void;
  error(): void;
  status(status: ConnectionStatus): void;
}

type Frame =
  | { type: "request" }
  | { type: "status"; status: ConnectionStatus; lastEventId: string }
  | { type: "message"; message: StreamMessage }
  | { type: "error" };

interface Entry {
  listeners: Set<StreamListener>;
  controller: AbortController;
  channel: TransportChannel;
  owner: boolean;
  status: ConnectionStatus;
  lastEventId: string;
}

const PREFIX = "openapply:sse:v2:";

function isFrame(value: unknown): value is Frame {
  if (!value || typeof value !== "object" || !("type" in value)) return false;
  if (value.type === "request" || value.type === "error") return true;
  if (value.type === "status")
    return (
      "status" in value &&
      ["connecting", "waiting", "open", "reconnecting"].includes(String(value.status)) &&
      "lastEventId" in value &&
      typeof value.lastEventId === "string"
    );
  if (value.type !== "message" || !("message" in value)) return false;
  const message = value.message;
  return (
    !!message &&
    typeof message === "object" &&
    "data" in message &&
    typeof message.data === "string" &&
    "lastEventId" in message &&
    typeof message.lastEventId === "string" &&
    "origin" in message &&
    typeof message.origin === "string"
  );
}

export function createSharedTransport(platform: TransportPlatform) {
  const entries = new Map<string, Entry>();
  let disposed = false;
  const identity = `${PREFIX}user:${platform.scope}:url:`;

  const close = (entry: Entry) => {
    entry.controller.abort();
    entry.channel.onmessage = null;
    entry.channel.close();
    entry.listeners.clear();
  };

  const deliver = (entry: Entry, frame: Frame) => {
    if (entry.controller.signal.aborted) return;
    if (frame.type === "status") {
      entry.status = frame.status;
      if (frame.lastEventId) entry.lastEventId = frame.lastEventId;
      for (const listener of entry.listeners) listener.status(frame.status);
    } else if (frame.type === "message") {
      if (frame.message.lastEventId) entry.lastEventId = frame.message.lastEventId;
      for (const listener of entry.listeners) listener.message(frame.message);
    } else if (frame.type === "error") {
      for (const listener of entry.listeners) listener.error();
    }
  };

  const publish = (entry: Entry, frame: Frame) => {
    if (entry.controller.signal.aborted) return;
    deliver(entry, frame);
    if (!entry.controller.signal.aborted) entry.channel.postMessage(frame);
  };

  const status = (entry: Entry, value: ConnectionStatus) =>
    publish(entry, { type: "status", status: value, lastEventId: entry.lastEventId });

  const lease = async (url: string, entry: Entry, slot: string) => {
    const signal = entry.controller.signal;
    if (signal.aborted) return;
    const connection: { source: StreamSource | null } = { source: null };
    let redialTimer: ReturnType<typeof setTimeout> | null = null;
    let delay = 2000;
    let finished = false;
    let release = () => {};
    const done = new Promise<void>((resolve) => {
      release = resolve;
    });
    signal.addEventListener("abort", release, { once: true });
    const rotate = setInterval(() => {
      void platform.locks
        .query()
        .then((state) => {
          // FIFO lock requests give every distinct URL a turn without churning idle streams.
          if (state.pending?.some((lock) => lock.name === slot)) release();
        })
        .catch(() => release());
    }, platform.leaseMs ?? 5000);

    const dial = () => {
      if (finished || signal.aborted) return;
      const current = platform.open(url, entry.lastEventId);
      connection.source = current;
      const active = () => !finished && !signal.aborted && connection.source === current;
      current.onmessage = (message) => {
        if (active())
          publish(entry, {
            type: "message",
            message: {
              data: message.data,
              lastEventId: message.lastEventId,
              origin: message.origin,
            },
          });
      };
      current.onopen = () => {
        if (!active()) return;
        delay = 2000;
        status(entry, "open");
      };
      current.onerror = () => {
        if (!active()) return;
        status(entry, "reconnecting");
        publish(entry, { type: "error" });
        if (current.readyState === current.CLOSED && redialTimer === null) {
          redialTimer = setTimeout(() => {
            redialTimer = null;
            delay = Math.min(delay * 2, 30000);
            dial();
          }, delay);
        }
      };
    };

    try {
      dial();
      await done;
    } finally {
      finished = true;
      clearInterval(rotate);
      if (redialTimer !== null) clearTimeout(redialTimer);
      signal.removeEventListener("abort", release);
      connection.source?.close();
      status(entry, entry.status === "reconnecting" ? "reconnecting" : "waiting");
    }
  };

  const own = async (url: string, entry: Entry) => {
    const signal = entry.controller.signal;
    try {
      await platform.locks.request(`${identity}${url}`, { signal }, async () => {
        if (signal.aborted) return;
        entry.owner = true;
        if (entry.status === "open") status(entry, "waiting");
        while (!signal.aborted)
          await withConnectionSlot(platform.locks, new URL(url).origin, signal, (slot) =>
            lease(url, entry, slot),
          );
      });
    } catch {
      if (!signal.aborted) {
        status(entry, "reconnecting");
        publish(entry, { type: "error" });
      }
    } finally {
      entry.owner = false;
    }
  };

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const entry of entries.values()) close(entry);
      entries.clear();
    },
    subscribe(url: string, listener: StreamListener) {
      if (disposed) {
        listener.status("idle");
        return () => {};
      }
      let entry = entries.get(url);
      if (!entry) {
        const created: Entry = {
          listeners: new Set(),
          controller: new AbortController(),
          channel: platform.channel(`${identity}${url}`),
          owner: false,
          status: "connecting",
          lastEventId: "0",
        };
        entries.set(url, created);
        created.channel.onmessage = ({ data }) => {
          if (!isFrame(data) || created.controller.signal.aborted) return;
          if (data.type === "request") {
            if (created.owner) status(created, created.status);
          } else if (!created.owner) deliver(created, data);
        };
        entry = created;
        void own(url, entry);
        entry.channel.postMessage({ type: "request" } satisfies Frame);
      }
      entry.listeners.add(listener);
      listener.status(entry.status);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        entry.listeners.delete(listener);
        if (entry.listeners.size > 0) return;
        if (entries.get(url) === entry) entries.delete(url);
        close(entry);
      };
    },
  };
}
