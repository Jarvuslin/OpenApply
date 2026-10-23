import { terminalRequest } from "./terminal-request";
import { afterEach, describe, expect, test } from "bun:test";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stalledFetch(): void {
  globalThis.fetch = ((_url: unknown, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    })) as unknown as typeof fetch;
}

describe("companion request recovery", () => {
  test("times out a companion that never responds and permits a fresh retry", async () => {
    stalledFetch();
    await expect(
      terminalRequest("http://localhost/test", {}, (response) => response.text(), {
        timeoutMs: 10,
      }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    globalThis.fetch = (async () => new Response("ready")) as unknown as typeof fetch;
    expect(await terminalRequest("http://localhost/test", {}, (response) => response.text())).toBe(
      "ready",
    );
  });

  test("Cancel aborts the fetch rather than only hiding its spinner", async () => {
    stalledFetch();
    const controller = new AbortController();
    const pending = terminalRequest("http://localhost/test", {}, (response) => response.text(), {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  test("an already cancelled request does not start network work", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response();
    }) as unknown as typeof fetch;
    await expect(
      terminalRequest("http://localhost/test", {}, (response) => response.text(), {
        signal: AbortSignal.abort(),
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(called).toBe(false);
  });

  test("deadline includes a stalled response body", async () => {
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) =>
      new Response(
        new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), {
              once: true,
            });
          },
        }),
      )) as unknown as typeof fetch;
    await expect(
      terminalRequest("http://localhost/test", {}, (response) => response.text(), {
        timeoutMs: 10,
      }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
  });
});
