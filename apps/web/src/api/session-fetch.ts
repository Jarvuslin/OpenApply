import { ApiError } from "./error";

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface SessionFetchOptions {
  origin: string;
  fetcher: Fetch;
  locks?: Pick<LockManager, "request">;
  timeoutMs?: number;
  readTimeoutMs?: number;
  channelMutationTimeoutMs?: number;
}

interface RestoredSession {
  active: boolean;
  renewed: boolean;
}

const SESSION_CHANGES = new Set(["/api/auth/login", "/api/auth/register", "/api/auth/logout"]);
const ACCOUNT_CHANGES = new Set([
  "/api/auth/password/change",
  "/api/auth/email/change",
  "/api/auth/email/resend",
]);

function channelMutation(method: string, pathname: string) {
  const path = pathname.replace(/\/$/, "");
  if (method === "DELETE")
    return path === "/api/telegram" || /^\/api\/telegram\/pairing\/[^/]+$/.test(path);
  if (method === "PATCH")
    return path === "/api/telegram/settings" || /^\/api\/credentials\/[^/]+$/.test(path);
  if (method === "PUT") return path === "/api/work-queue/limits";
  if (method !== "POST") return false;
  return (
    path === "/api/telegram/pairing" ||
    path === "/api/credentials" ||
    path === "/api/auth/tokens/terminal" ||
    path === "/api/account-setup" ||
    /^\/api\/account-setup\/[^/]+\/(credentials|continue)$/.test(path) ||
    /^\/api\/work-queue\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/control$/i.test(
      path,
    ) ||
    path === "/api/job-intakes" ||
    /^\/api\/job-intakes\/[^/]+\/(prepare|decision)$/.test(path) ||
    /^\/api\/pilot\/questions\/[^/]+\/decision$/.test(path)
  );
}

function withinSignal<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

/** Each browser tab owns this state; server requests must never share a session refresh. */
export function createSessionFetch(options: SessionFetchOptions): Fetch {
  const {
    fetcher,
    locks,
    timeoutMs = 10_000,
    readTimeoutMs = 30_000,
    channelMutationTimeoutMs = 15_000,
  } = options;
  const origin = new URL(options.origin).origin;
  const lockName = `openapply-session:${origin}`;
  let refresh: Promise<RestoredSession> | undefined;
  let lastSession: RestoredSession = { active: false, renewed: false };
  let generation = 0;
  let sessionChange = 0;
  let sessionQueue = Promise.resolve();

  async function withLock<T>(run: () => Promise<T>): Promise<T> {
    const signal = AbortSignal.timeout(timeoutMs);
    const pending = sessionQueue.then(() => {
      signal.throwIfAborted();
      if (!locks) return run();
      return locks.request(lockName, { signal }, run);
    });
    sessionQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  async function readSession(request: Request): Promise<Response> {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
    const response = await fetcher(request, { signal, cache: "no-store" });
    // Read within the deadline too, so partial /me responses cannot leave sign-in loading forever.
    const body = await response.arrayBuffer();
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  async function renew(): Promise<RestoredSession> {
    // Another tab may have renewed the cookies while this tab waited for the lock.
    const probe = await readSession(
      new Request(`${origin}/api/auth/me`, { credentials: "include" }),
    );
    if (probe.ok) return { active: true, renewed: false };
    if (probe.status !== 401) throw new ApiError({ status: probe.status });

    const renewed = await fetcher(`${origin}/api/auth/refresh`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Refresh token values stay in httpOnly cookies; the response body is not needed.
    await renewed.body?.cancel();
    if (renewed.status === 401) return { active: false, renewed: false };
    if (!renewed.ok) throw new ApiError({ status: renewed.status });
    return { active: true, renewed: true };
  }

  async function restore(expectedSession: number): Promise<RestoredSession> {
    if (!refresh) {
      refresh = withLock(() => {
        if (expectedSession !== sessionChange) {
          return Promise.resolve({ active: false, renewed: false });
        }
        return renew();
      })
        .then((restored) => {
          generation += 1;
          lastSession = restored;
          return restored;
        })
        .finally(() => {
          refresh = undefined;
        });
    }
    return refresh;
  }

  return async (input, init) => {
    const original = new Request(input, init);
    const url = new URL(original.url);
    if (url.origin !== origin) return fetcher(original);
    const isApiRead =
      url.pathname.startsWith("/api/") && (original.method === "GET" || original.method === "HEAD");
    const isChannelMutation = channelMutation(original.method, url.pathname);
    let deadline: number | undefined;
    if (isApiRead) deadline = readTimeoutMs;
    if (isChannelMutation) deadline = channelMutationTimeoutMs;
    // Keep the signal alive through response-body reads, including after session recovery.
    const request =
      deadline !== undefined
        ? new Request(original, {
            signal: AbortSignal.any([original.signal, AbortSignal.timeout(deadline)]),
          })
        : original;

    if (SESSION_CHANGES.has(url.pathname)) {
      sessionChange += 1;
      // Credential submissions run exactly once and cannot race an in-flight renewal.
      return withLock(() => readSession(request));
    }

    const isSessionProbe = url.pathname === "/api/auth/me";
    const isAccountChange =
      ACCOUNT_CHANGES.has(url.pathname) ||
      (request.method === "DELETE" && url.pathname.startsWith("/api/auth/providers/"));
    const checksPassword =
      url.pathname === "/api/auth/password/change" || url.pathname === "/api/auth/email/change";
    const canRestore =
      url.pathname.startsWith("/api/") &&
      (!url.pathname.startsWith("/api/auth/") ||
        isSessionProbe ||
        url.pathname.startsWith("/api/auth/tokens") ||
        isAccountChange);
    if (!canRestore) return fetcher(request);

    const startedGeneration = generation;
    const startedSession = sessionChange;
    // Retain a replayable copy, including multipart resume uploads.
    const response = isSessionProbe
      ? await readSession(request.clone())
      : await fetcher(request.clone());
    if (response.status !== 401 || startedSession !== sessionChange) return response;
    request.signal.throwIfAborted();

    let restored = lastSession;
    if (startedGeneration === generation) {
      const pending = restore(startedSession);
      restored = isChannelMutation ? await withinSignal(pending, request.signal) : await pending;
    }
    request.signal.throwIfAborted();
    // A channel action may have committed already; recovery never resends its mutation.
    if (isChannelMutation) return response;
    // A healthy session may mean a password-checking endpoint rejected the supplied credentials.
    if (
      !restored.active ||
      (checksPassword && !restored.renewed) ||
      startedSession !== sessionChange
    ) {
      return response;
    }
    request.signal.throwIfAborted();
    // Never recurse: a second 401 is a real authentication failure.
    return isSessionProbe ? readSession(request) : fetcher(request);
  };
}
