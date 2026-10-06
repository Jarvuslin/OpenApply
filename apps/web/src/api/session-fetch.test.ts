import { createSessionFetch } from "./session-fetch";
import { describe, expect, test } from "bun:test";

const origin = "https://api.openapply.test";
const path = (input: RequestInfo | URL) =>
  new URL(input instanceof Request ? input.url : input.toString()).pathname;
const ok = () => Response.json({ ok: true });
const unauthorized = () => new Response("unauthorized", { status: 401 });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("browser session recovery", () => {
  test("concurrent expired requests share one renewal and replay their bodies", async () => {
    let refreshed = false;
    let renewals = 0;
    const bodies: string[] = [];
    const sessionFetch = createSessionFetch({
      origin,
      fetcher: async (input, init) => {
        if (path(input) === "/api/auth/refresh") {
          expect(init?.credentials).toBe("include");
          renewals += 1;
          refreshed = true;
          return ok();
        }
        if (path(input) === "/api/auth/me") return unauthorized();
        bodies.push(await (input as Request).text());
        return refreshed ? ok() : unauthorized();
      },
    });
    const results = await Promise.all(
      ["one", "two"].map((body) => sessionFetch(`${origin}/api/resumes`, { method: "POST", body })),
    );
    expect(results.map((response) => response.status)).toEqual([200, 200]);
    expect(renewals).toBe(1);
    expect(bodies.sort()).toEqual(["one", "one", "two", "two"]);
  });

  test("a late 401 reuses the renewal that already finished", async () => {
    const late = deferred<Response>();
    let lateCalls = 0;
    let renewals = 0;
    const sessionFetch = createSessionFetch({
      origin,
      fetcher: async (input) => {
        if (path(input) === "/api/late" && ++lateCalls === 1) return late.promise;
        if (path(input) === "/api/auth/refresh") {
          renewals += 1;
          return ok();
        }
        if (path(input) === "/api/auth/me") return unauthorized();
        return renewals > 0 ? ok() : unauthorized();
      },
    });
    const slow = sessionFetch(`${origin}/api/late`);
    expect((await sessionFetch(`${origin}/api/fast`)).status).toBe(200);
    late.resolve(unauthorized());
    expect((await slow).status).toBe(200);
    expect(renewals).toBe(1);
  });

  test("a second 401 is returned without an infinite refresh loop", async () => {
    let calls = 0;
    const sessionFetch = createSessionFetch({
      origin,
      fetcher: async (input) => {
        calls += 1;
        return path(input) === "/api/auth/refresh" ? ok() : unauthorized();
      },
    });
    expect((await sessionFetch(`${origin}/api/private`)).status).toBe(401);
    expect(calls).toBe(4);
  });

  test.each(["login", "register", "logout", "refresh", "password/reset", "email/verify"])(
    "%s is submitted once and never causes a refresh",
    async (endpoint) => {
      let calls = 0;
      const sessionFetch = createSessionFetch({
        origin,
        fetcher: async () => {
          calls += 1;
          return unauthorized();
        },
      });
      expect(
        (await sessionFetch(`${origin}/api/auth/${endpoint}`, { method: "POST" })).status,
      ).toBe(401);
      expect(calls).toBe(1);
    },
  );

  test("outages remain connection errors instead of signed-out errors", async () => {
    const sessionFetch = createSessionFetch({
      origin,
      fetcher: async (input) => {
        if (path(input) === "/api/auth/refresh") return new Response(null, { status: 503 });
        return unauthorized();
      },
    });
    await expect(sessionFetch(`${origin}/api/private`)).rejects.toMatchObject({ status: 503 });
  });

  test("does not refresh foreign origins or retry a non-auth server error", async () => {
    let calls = 0;
    const sessionFetch = createSessionFetch({
      origin,
      fetcher: async () => {
        calls += 1;
        return new Response(null, { status: 503 });
      },
    });
    expect((await sessionFetch(`${origin}/api/private`)).status).toBe(503);
    expect((await sessionFetch("https://other.test/api/private")).status).toBe(503);
    expect(calls).toBe(2);
  });

  test("logout waits for renewal without Web Locks and prevents the old request replay", async () => {
    const renewing = deferred<void>();
    const finishRenewal = deferred<Response>();
    const actions: string[] = [];
    const sessionFetch = createSessionFetch({
      origin,
      fetcher: async (input) => {
        const endpoint = path(input);
        actions.push(endpoint);
        if (endpoint === "/api/auth/refresh") {
          renewing.resolve();
          return finishRenewal.promise;
        }
        return endpoint === "/api/auth/logout" ? ok() : unauthorized();
      },
    });
    const pending = sessionFetch(`${origin}/api/private`);
    await renewing.promise;
    const logout = sessionFetch(`${origin}/api/auth/logout`, { method: "POST" });
    expect(actions).not.toContain("/api/auth/logout");
    finishRenewal.resolve(ok());
    expect((await pending).status).toBe(401);
    expect((await logout).status).toBe(200);
    expect(actions).toEqual([
      "/api/private",
      "/api/auth/me",
      "/api/auth/refresh",
      "/api/auth/logout",
    ]);
  });

  test.each(["/api/private", "/api/auth/email/resend", "/api/auth/providers/google"])(
    "a renewal completed by another tab restores %s under the shared lock",
    async (endpoint) => {
      let locked = false;
      let renewals = 0;
      const locks = {
        request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => {
          locked = true;
          return run();
        },
      } as unknown as Pick<LockManager, "request">;
      const sessionFetch = createSessionFetch({
        origin,
        locks,
        fetcher: async (input) => {
          if (path(input) === "/api/auth/refresh") renewals += 1;
          return locked ? ok() : unauthorized();
        },
      });
      const method = endpoint.includes("/providers/") ? "DELETE" : "POST";
      expect((await sessionFetch(`${origin}${endpoint}`, { method })).status).toBe(200);
      expect(renewals).toBe(0);
    },
  );

  test("a stalled session probe times out and can be retried", async () => {
    let stalled = true;
    const sessionFetch = createSessionFetch({
      origin,
      timeoutMs: 10,
      fetcher: async (_input, init) => {
        if (!stalled) return ok();
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        });
      },
    });
    await expect(sessionFetch(`${origin}/api/auth/me`)).rejects.toMatchObject({
      name: "TimeoutError",
    });
    stalled = false;
    expect((await sessionFetch(`${origin}/api/auth/me`)).status).toBe(200);
  });

  test("a cancelled protected request does not start a renewal", async () => {
    const controller = new AbortController();
    let calls = 0;
    const sessionFetch = createSessionFetch({
      origin,
      fetcher: async () => {
        calls += 1;
        controller.abort();
        return unauthorized();
      },
    });
    await expect(
      sessionFetch(`${origin}/api/private`, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(1);
  });

  test.each(["password/change", "email/change", "email/resend", "providers/google"])(
    "an expired session restores an authenticated account action: %s",
    async (endpoint) => {
      let renewed = false;
      const sessionFetch = createSessionFetch({
        origin,
        fetcher: async (input) => {
          if (path(input) === "/api/auth/refresh") renewed = true;
          return renewed ? ok() : unauthorized();
        },
      });
      const method = endpoint.startsWith("providers/") ? "DELETE" : "POST";
      expect((await sessionFetch(`${origin}/api/auth/${endpoint}`, { method })).status).toBe(200);
    },
  );

  test("wrong current password is never replayed when the session is healthy", async () => {
    let submissions = 0;
    const sessionFetch = createSessionFetch({
      origin,
      fetcher: async (input) => {
        if (path(input) === "/api/auth/me") return ok();
        submissions += 1;
        return unauthorized();
      },
    });
    expect(
      (await sessionFetch(`${origin}/api/auth/password/change`, { method: "POST" })).status,
    ).toBe(401);
    expect(submissions).toBe(1);
  });

  test("a stalled refresh times out and does not permanently block later attempts", async () => {
    let stalled = true;
    const sessionFetch = createSessionFetch({
      origin,
      timeoutMs: 10,
      fetcher: async (input, init) => {
        if (!stalled) return ok();
        if (path(input) !== "/api/auth/refresh") return unauthorized();
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        });
      },
    });
    await expect(sessionFetch(`${origin}/api/private`)).rejects.toMatchObject({
      name: "TimeoutError",
    });
    stalled = false;
    expect((await sessionFetch(`${origin}/api/private`)).status).toBe(200);
  });
});
