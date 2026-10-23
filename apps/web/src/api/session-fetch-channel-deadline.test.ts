import { createSessionFetch } from "./session-fetch";
import { describe, expect, test } from "bun:test";

const origin = "https://openapply.example.test";
const id = "5a386bb7-93c5-423e-9ec1-438e38a8b34b";
const mutations = [
  ["POST", "/api/credentials/"],
  ["PATCH", `/api/credentials/${id}`],
  ["POST", "/api/telegram/pairing"],
  ["DELETE", `/api/telegram/pairing/${id}`],
  ["DELETE", "/api/telegram/"],
  ["PATCH", "/api/telegram/settings"],
  ["POST", "/api/job-intakes/"],
  ["POST", `/api/job-intakes/${id}/prepare`],
  ["POST", `/api/job-intakes/${id}/decision`],
  ["POST", `/api/pilot/questions/${id}/decision`],
  ["POST", "/api/auth/tokens/terminal"],
  ["POST", "/api/account-setup/"],
  ["POST", `/api/account-setup/${id}/credentials`],
  ["POST", `/api/account-setup/${id}/continue`],
  ["POST", `/api/work-queue/${id}/control`],
  ["PUT", "/api/work-queue/limits"],
] as const;

function stalled(signal: AbortSignal): Promise<Response> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

describe("bounded channel mutations", () => {
  test.each(mutations)("%s %s times out before headers without retrying", async (method, path) => {
    let calls = 0;
    const sessionFetch = createSessionFetch({
      origin,
      channelMutationTimeoutMs: 10,
      fetcher: async (input) => {
        calls++;
        return stalled(new Request(input).signal);
      },
    });
    await expect(sessionFetch(origin + path, { method, body: "{}" })).rejects.toMatchObject({
      name: "TimeoutError",
    });
    expect(calls).toBe(1);
  });

  test.each(mutations)(
    "%s %s retains the deadline through a stalled response body",
    async (method, path) => {
      let calls = 0;
      const sessionFetch = createSessionFetch({
        origin,
        channelMutationTimeoutMs: 10,
        fetcher: async (input) => {
          calls++;
          const signal = new Request(input).signal;
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('{"saved":'));
                if (signal.aborted) controller.error(signal.reason);
                else
                  signal.addEventListener("abort", () => controller.error(signal.reason), {
                    once: true,
                  });
              },
            }),
            { status: 200 },
          );
        },
      });
      const response = await sessionFetch(origin + path, {
        method,
        body: "{}",
      });
      expect(response.status).toBe(200);
      await expect(response.json()).rejects.toMatchObject({ name: "TimeoutError" });
      expect(calls).toBe(1);
    },
  );

  test("caller cancellation wins before the mutation deadline", async () => {
    const caller = new AbortController();
    const sessionFetch = createSessionFetch({
      origin,
      channelMutationTimeoutMs: 10_000,
      fetcher: async (input) => {
        const pending = stalled(new Request(input).signal);
        caller.abort(new DOMException("Cancelled", "AbortError"));
        return pending;
      },
    });
    await expect(
      sessionFetch(`${origin}/api/telegram/pairing`, {
        method: "POST",
        body: "{}",
        signal: caller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  test.each(mutations)(
    "%s %s is never automatically replayed after session recovery",
    async (method, path) => {
      const paths: string[] = [];
      const sessionFetch = createSessionFetch({
        origin,
        fetcher: async (input) => {
          const path = new URL(new Request(input).url).pathname;
          paths.push(path);
          return new Response(null, { status: path === "/api/auth/refresh" ? 200 : 401 });
        },
      });
      expect((await sessionFetch(origin + path, { method, body: "{}" })).status).toBe(401);
      expect(paths).toEqual([path, "/api/auth/me", "/api/auth/refresh"]);
    },
  );

  test.each(mutations)("%s %s bounds waiting for shared session recovery", async (method, path) => {
    let finishRecovery: ((value: Response) => void) | undefined;
    const paths: string[] = [];
    const sessionFetch = createSessionFetch({
      origin,
      timeoutMs: 10_000,
      channelMutationTimeoutMs: 10,
      fetcher: async (input) => {
        const path = new URL(new Request(input).url).pathname;
        paths.push(path);
        if (path === "/api/auth/me")
          return new Promise((resolve) => {
            finishRecovery = resolve;
          });
        return new Response(null, { status: 401 });
      },
    });
    await expect(sessionFetch(origin + path, { method, body: "{}" })).rejects.toMatchObject({
      name: "TimeoutError",
    });
    expect(paths).toEqual([path, "/api/auth/me"]);
    finishRecovery?.(Response.json({ id }));
  });

  test("unrelated uploads and other origins do not inherit the channel deadline", async () => {
    const sessionFetch = createSessionFetch({
      origin,
      channelMutationTimeoutMs: 1,
      readTimeoutMs: 1,
      fetcher: async (input) => {
        await Bun.sleep(10);
        new Request(input).signal.throwIfAborted();
        return Response.json({ saved: true });
      },
    });
    expect(
      (await sessionFetch(`${origin}/api/resumes`, { method: "POST", body: "large upload" }))
        .status,
    ).toBe(200);
    expect(
      (
        await sessionFetch("https://other.example.test/api/telegram/pairing", {
          method: "POST",
          body: "{}",
        })
      ).status,
    ).toBe(200);
  });
});
