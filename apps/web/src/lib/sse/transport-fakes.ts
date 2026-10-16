import type {
  StreamSource,
  TransportChannel,
  TransportLocks,
  TransportPlatform,
} from "./shared-transport";

interface LockRequest {
  name: string;
  start(): void;
  reject(error: Error): void;
  removeAbort(): void;
}

class TestLocks implements TransportLocks {
  active = new Set<string>();
  pending: LockRequest[] = [];

  request(name: string, options: { signal: AbortSignal }, callback: () => Promise<void>) {
    return new Promise<void>((resolve, reject) => {
      const abort = () => {
        const index = this.pending.indexOf(request);
        if (index !== -1) {
          this.pending.splice(index, 1);
          request.removeAbort();
          reject(new DOMException("Aborted", "AbortError"));
        }
      };
      const request: LockRequest = {
        name,
        reject,
        removeAbort: () => options.signal.removeEventListener("abort", abort),
        start: () => {
          request.removeAbort();
          this.active.add(name);
          Promise.resolve()
            .then(callback)
            .then(resolve, reject)
            .finally(() => {
              this.active.delete(name);
              this.pump();
            });
        },
      };
      if (options.signal.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      options.signal.addEventListener("abort", abort);
      this.pending.push(request);
      this.pump();
    });
  }

  async query() {
    return { pending: this.pending.map(({ name }) => ({ name })) };
  }

  private pump() {
    for (const request of [...this.pending]) {
      if (this.active.has(request.name)) continue;
      this.pending.splice(this.pending.indexOf(request), 1);
      request.start();
    }
  }
}

class TestSource implements StreamSource {
  readyState = 0;
  CLOSED = 2;
  onmessage: StreamSource["onmessage"] = null;
  onopen: StreamSource["onopen"] = null;
  onerror: StreamSource["onerror"] = null;
  constructor(
    readonly url: string,
    readonly cursor: string,
  ) {}
  close() {
    this.readyState = this.CLOSED;
  }
  connected() {
    this.readyState = 1;
    this.onopen?.();
  }
  message(data: string, id: string) {
    this.onmessage?.({ data, lastEventId: id, origin: new URL(this.url).origin });
  }
}

export class TransportFixture {
  readonly locks = new TestLocks();
  readonly sources: TestSource[] = [];
  readonly channels = new Map<string, Set<TransportChannel>>();
  maxOpen = 0;

  platform(leaseMs = 10, scope = "user-one"): TransportPlatform {
    return {
      scope,
      locks: this.locks,
      channel: (name) => {
        let members = this.channels.get(name);
        if (!members) {
          members = new Set();
          this.channels.set(name, members);
        }
        const channel: TransportChannel = {
          onmessage: null,
          postMessage: (data) => {
            for (const target of members) {
              if (target !== channel) queueMicrotask(() => target.onmessage?.({ data }));
            }
          },
          close: () => {
            members.delete(channel);
            channel.onmessage = null;
          },
        };
        members.add(channel);
        return channel;
      },
      open: (url, cursor) => {
        const source = new TestSource(url, cursor);
        this.sources.push(source);
        this.maxOpen = Math.max(this.maxOpen, this.open().length);
        return source;
      },
      leaseMs,
    };
  }

  open() {
    return this.sources.filter((source) => source.readyState !== source.CLOSED);
  }
}

export async function eventually(predicate: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Condition did not become true");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
