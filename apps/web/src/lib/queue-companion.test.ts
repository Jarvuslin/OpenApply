import {
  connectQueueCompanion,
  disconnectQueueCompanion,
  getQueueCompanion,
  getQueueFrame,
} from "./queue-companion";
import { afterEach, describe, expect, test } from "bun:test";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const disabled = {
  connectionId: null,
  ownerId: null,
  connected: false,
  running: false,
  blockingReason: "Model execution is disabled by the host budget.",
  lastError: null,
  configuredCapacity: 1,
  effectiveCapacity: 0,
  workers: [],
  budget: { enabled: false, remainingAllocations: 0, reason: "No approved model allocation." },
};

describe("model-free queue connection", () => {
  test("status performs only a GET and preserves the zero-budget reason", async () => {
    const requests: Array<[string, string | undefined]> = [];
    globalThis.fetch = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      requests.push([String(url), init?.method]);
      return Response.json(disabled);
    }) as unknown as typeof fetch;
    expect(await getQueueCompanion()).toEqual(disabled);
    expect(requests).toEqual([["http://localhost:4102/queue/status", "GET"]]);
  });

  test("explicit connection and disconnection use the common queue endpoints", async () => {
    const requests: Array<[string, string | undefined]> = [];
    globalThis.fetch = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      requests.push([new URL(String(url)).pathname, init?.method]);
      if (init?.method === "DELETE") {
        const target = new URL(String(url));
        expect(target.searchParams.get("expectedOwnerId")).toBe(
          "11111111-1111-4111-8111-111111111111",
        );
        expect(target.searchParams.get("connectionId")).toBe(
          "22222222-2222-4222-8222-222222222222",
        );
        expect(target.href).not.toContain("synthetic-token");
        expect(new Headers(init.headers).get("authorization")).toBe("Bearer synthetic-token");
      }
      return Response.json(disabled);
    }) as unknown as typeof fetch;
    await connectQueueCompanion({
      apiToken: "synthetic-token",
      apiUrl: "http://api.test/api",
      webUrl: "http://web.test",
    });
    await disconnectQueueCompanion({
      apiToken: "synthetic-token",
      expectedOwnerId: "11111111-1111-4111-8111-111111111111",
      connectionId: "22222222-2222-4222-8222-222222222222",
    });
    expect(requests).toEqual([
      ["/queue/connect", "POST"],
      ["/queue/connection", "DELETE"],
    ]);
  });

  test("an HTTP error cannot masquerade as a connected worker", async () => {
    globalThis.fetch = (async () =>
      new Response("unavailable", { status: 503 })) as unknown as typeof fetch;
    await expect(getQueueCompanion()).rejects.toThrow("could not update");
  });

  test("a connected multiworker host preserves independent worker state and finite allocations", async () => {
    const status = {
      ...disabled,
      connected: true,
      running: true,
      configuredCapacity: 3,
      effectiveCapacity: 2,
      workers: [1, 2].map((slot) => ({
        workerId: `worker-${slot}`,
        slot,
        workItemId: `work-${slot}`,
        executionId: `execution-${slot}`,
        browserSessionId: `browser-${slot}`,
        state: "running" as const,
      })),
      budget: { enabled: true, remainingAllocations: 2, reason: null },
    };
    globalThis.fetch = (async () => Response.json(status)) as unknown as typeof fetch;
    expect(await getQueueCompanion()).toEqual(status);
    globalThis.fetch = (async () =>
      Response.json({ ...status, effectiveCapacity: 4 })) as unknown as typeof fetch;
    await expect(getQueueCompanion()).rejects.toThrow();
  });
});

describe("bounded read-only worker view", () => {
  const worker = {
    workerId: "33333333-3333-4333-8333-333333333333",
    slot: 1,
    workItemId: "11111111-1111-4111-8111-111111111111",
    executionId: "22222222-2222-4222-8222-222222222222",
    browserSessionId: "44444444-4444-4444-8444-444444444444",
    state: "running" as const,
  };
  const frame = {
    workItemId: worker.workItemId,
    executionId: worker.executionId,
    browserSessionId: worker.browserSessionId,
    capturedAt: new Date().toISOString(),
    mimeType: "image/jpeg" as const,
    imageBase64: "/9j/2Q==",
    width: 1366,
    height: 768,
  };
  test("one bounded authenticated GET contains no token in URL and verifies all identities", async () => {
    globalThis.fetch = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      expect(String(url)).not.toContain("private-token");
      expect(new URL(String(url)).searchParams.get("workItemId")).toBe(worker.workItemId);
      expect(init?.method).toBe("GET");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer private-token");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Response.json(frame);
    }) as unknown as typeof fetch;
    expect(await getQueueFrame(worker, "private-token", new AbortController().signal)).toEqual(
      frame,
    );
  });
  test.each(["workItemId", "executionId", "browserSessionId"])(
    "rejects a swapped %s before displaying a frame",
    async (field) => {
      globalThis.fetch = (async () =>
        Response.json({
          ...frame,
          [field]: "55555555-5555-4555-8555-555555555555",
        })) as unknown as typeof fetch;
      await expect(
        getQueueFrame(worker, "private-token", new AbortController().signal),
      ).rejects.toThrow("worker changed");
    },
  );
  test("refuses unbounded or executable image content", async () => {
    for (const value of [
      { ...frame, mimeType: "image/svg+xml" },
      { ...frame, imageBase64: "a".repeat(901_000) },
    ]) {
      globalThis.fetch = (async () => Response.json(value)) as unknown as typeof fetch;
      await expect(
        getQueueFrame(worker, "private-token", new AbortController().signal),
      ).rejects.toThrow();
    }
  });
  test("refuses stale and future-dated frames even when worker identity matches", async () => {
    for (const offset of [-31_000, 11_000]) {
      globalThis.fetch = (async () =>
        Response.json({
          ...frame,
          capturedAt: new Date(Date.now() + offset).toISOString(),
        })) as unknown as typeof fetch;
      await expect(
        getQueueFrame(worker, "private-token", new AbortController().signal),
      ).rejects.toThrow("stale");
    }
  });
  test("aborting a closed view cannot start another request", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return Response.json(frame);
    }) as unknown as typeof fetch;
    const controller = new AbortController();
    controller.abort();
    await expect(getQueueFrame(worker, "private-token", controller.signal)).rejects.toThrow();
    expect(calls).toBe(0);
  });
});
