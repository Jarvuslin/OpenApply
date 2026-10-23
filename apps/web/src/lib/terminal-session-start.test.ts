import type { SessionStatus, TerminalProviderId } from "./terminal";
import { createSessionStarter } from "./terminal-session-start";
import { describe, expect, test } from "bun:test";

function status(provider: TerminalProviderId, running = true): SessionStatus {
  return {
    status: "ok",
    session: running ? "running" : "stopped",
    provider,
    providers: [],
    hostVersion: "test",
    canRelaunch: false,
    canUpdate: false,
  };
}

function request(provider: TerminalProviderId) {
  return { provider, cols: 80, rows: 24 };
}

describe("terminal start reconciliation", () => {
  test("attaches to an existing session without replacing it", async () => {
    let starts = 0;
    const ensure = createSessionStarter({
      getStatus: async () => status("claude"),
      startSession: async () => {
        starts++;
        return status("claude");
      },
    });
    await ensure(request("claude"), new AbortController().signal);
    await expect(ensure(request("codex"), new AbortController().signal)).rejects.toThrow(
      "running claude",
    );
    expect(starts).toBe(0);
  });

  test("a remount starts its selected provider after a shared start was stopped", async () => {
    const first = Promise.withResolvers<SessionStatus>();
    const starting = Promise.withResolvers<void>();
    let current = status("claude", false);
    const started: TerminalProviderId[] = [];
    const ensure = createSessionStarter({
      getStatus: async () => current,
      startSession: async (options) => {
        started.push(options.provider);
        if (started.length === 1) {
          starting.resolve();
          return first.promise;
        }
        current = status(options.provider);
        return current;
      },
    });
    const original = ensure(request("claude"), new AbortController().signal);
    const originalOutcome = original.catch((error: unknown) => error);
    await starting.promise;
    const remount = ensure(request("codex"), new AbortController().signal);
    first.resolve(status("claude"));
    await remount;
    await originalOutcome;
    expect(started).toEqual(["claude", "codex"]);
    expect(current.provider).toBe("codex");
  });

  test("a provider switch cannot silently join a different pending provider", async () => {
    const first = Promise.withResolvers<SessionStatus>();
    const starting = Promise.withResolvers<void>();
    let current = status("claude", false);
    let starts = 0;
    const ensure = createSessionStarter({
      getStatus: async () => current,
      startSession: async () => {
        starts++;
        starting.resolve();
        return first.promise;
      },
    });
    const original = ensure(request("claude"), new AbortController().signal);
    await starting.promise;
    const switched = ensure(request("codex"), new AbortController().signal);
    current = status("claude");
    first.resolve(current);
    await original;
    await expect(switched).rejects.toThrow("running claude");
    expect(starts).toBe(1);
  });

  test("a timed-out response attaches when health proves the requested session started", async () => {
    let current = status("codex", false);
    let starts = 0;
    const ensure = createSessionStarter({
      getStatus: async () => current,
      startSession: async () => {
        starts++;
        current = status("codex");
        throw new DOMException("response stalled", "TimeoutError");
      },
    });
    await ensure(request("codex"), new AbortController().signal);
    expect(starts).toBe(1);
  });

  test("an unknown start outcome never triggers an automatic second start", async () => {
    let starts = 0;
    const ensure = createSessionStarter({
      getStatus: async () => status("codex", false),
      startSession: async () => {
        starts++;
        throw new DOMException("response stalled", "TimeoutError");
      },
    });
    await expect(ensure(request("codex"), new AbortController().signal)).rejects.toMatchObject({
      name: "TimeoutError",
    });
    expect(starts).toBe(1);
  });
});
