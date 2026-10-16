import { createSessionFetch } from "./session-fetch";
import { afterEach, describe, expect, test } from "bun:test";

let stopServer: (() => void) | undefined;
afterEach(() => {
  stopServer?.();
  stopServer = undefined;
});

function serve(fetcher: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: fetcher });
  stopServer = () => server.stop(true);
  return server.url.origin;
}

describe("API read deadlines", () => {
  test.each(["GET", "HEAD"])("a stalled %s fails and a later read can recover", async (method) => {
    let calls = 0;
    let stalled = true;
    const origin = serve(() => {
      calls += 1;
      return stalled ? new Promise<Response>(() => {}) : Response.json({ loaded: true });
    });
    const sessionFetch = createSessionFetch({ origin, fetcher: fetch, readTimeoutMs: 50 });
    await expect(sessionFetch(`${origin}/api/user`, { method })).rejects.toMatchObject({
      name: "TimeoutError",
    });
    expect(calls).toBe(1);
    stalled = false;
    expect((await sessionFetch(`${origin}/api/user`, { method })).status).toBe(200);
    expect(calls).toBe(2);
  });

  test("the deadline also aborts a response stalled after its headers", async () => {
    const origin = serve(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"pending":'));
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    const sessionFetch = createSessionFetch({ origin, fetcher: fetch, readTimeoutMs: 100 });
    const response = await sessionFetch(`${origin}/api/analytics`);
    expect(response.status).toBe(200);
    await expect(response.text()).rejects.toBeDefined();
  });

  test("caller cancellation reaches the request without waiting for its deadline", async () => {
    const controller = new AbortController();
    const origin = serve(() => {
      controller.abort(new DOMException("Caller cancelled", "AbortError"));
      return new Promise<Response>(() => {});
    });
    const sessionFetch = createSessionFetch({ origin, fetcher: fetch, readTimeoutMs: 10_000 });
    await expect(
      sessionFetch(`${origin}/api/user`, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  test("read deadlines do not abort a slower mutation or replay network failures", async () => {
    let calls = 0;
    const origin = serve(async () => {
      calls += 1;
      await Bun.sleep(30);
      return Response.json({ saved: true });
    });
    const sessionFetch = createSessionFetch({ origin, fetcher: fetch, readTimeoutMs: 5 });
    expect((await sessionFetch(`${origin}/api/user`, { method: "PUT", body: "{}" })).status).toBe(
      200,
    );
    expect(calls).toBe(1);
    let failures = 0;
    const failingFetch = createSessionFetch({
      origin,
      fetcher: async () => {
        failures += 1;
        throw new TypeError("Network unavailable");
      },
    });
    await expect(
      failingFetch(`${origin}/api/campaigns`, { method: "POST", body: "{}" }),
    ).rejects.toThrow("Network unavailable");
    expect(failures).toBe(1);
  });
});
