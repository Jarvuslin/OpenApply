import { createRedactor, requireLoopback } from "../apply-e2e/api.mjs";

const preparationRoutes = [
  /^POST \/api\/auth\/register$/,
  /^PUT \/api\/user\/(?:primary-resume)?$/,
  /^POST \/api\/resumes\/upload$/,
  /^PUT \/api\/resumes\/[\w-]+$/,
  /^POST \/api\/resumes\/(?:variants\/)?[\w-]+\/(?:artifacts|variants|tailor)$/,
  /^POST \/api\/campaigns\/$/,
  /^POST \/api\/campaigns\/[\w-]+\/jobs$/,
  /^PATCH \/api\/campaigns\/[\w-]+\/jobs\/[^/]+$/,
  /^PUT \/api\/jobs\/[\w-]+\/questions\/observations$/,
  /^POST \/api\/application-questions\/[\w-]+\/answers$/,
  /^POST \/api\/application-questions\/[\w-]+\/document-selection$/,
  /^POST \/api\/score-fit(?:\/context|\/)?$/,
];
const runtimeRoutes = [
  /^POST \/api\/auth\/tokens\/terminal$/,
  /^POST \/api\/work-queue\/(?:enqueue|ordered)$/,
  /^POST \/api\/work-queue\/[\w-]+\/control$/,
  /^POST \/api\/campaigns\/[\w-]+\/status$/,
];

// Submission state is exclusively written by the actual queue worker, never this client.
export function createQueueApi(baseUrl, { fetchImpl = fetch, redactor = createRedactor() } = {}) {
  const origin = requireLoopback(baseUrl).origin;
  let session;
  let sealed = false;
  const request = async (
    path,
    { method = "GET", body, binary = false, timeoutMs = 30_000 } = {},
  ) => {
    const url = new URL(path, origin);
    if (url.origin !== origin || !url.pathname.startsWith("/api/"))
      throw new Error("Queue fixture API must remain on its dedicated loopback origin.");
    const route = `${method} ${url.pathname}`;
    if (
      method !== "GET" &&
      !runtimeRoutes.some((item) => item.test(route)) &&
      (sealed || !preparationRoutes.some((item) => item.test(route)))
    )
      throw new Error(`Queue fixture mutation forbidden: ${route}`);
    if (session && Date.now() >= session.expiresAt - 60_000) {
      const renewed = await fetchImpl(`${origin}/api/auth/refresh`, {
        method: "POST",
        headers: { cookie: `refreshToken=${session.refreshToken}` },
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      if (!renewed.ok) throw new Error("Synthetic session refresh failed.");
      setSession(await renewed.json());
    }
    const headers = new Headers();
    if (session) headers.set("authorization", `Bearer ${session.accessToken}`);
    if (body !== undefined && !(body instanceof FormData))
      headers.set("content-type", "application/json");
    const response = await fetchImpl(url, {
      method,
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok)
      throw new Error(`Synthetic API ${method} ${url.pathname} returned ${response.status}.`);
    return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
  };
  const setSession = (value) => {
    const claims = JSON.parse(Buffer.from(value.accessToken.split(".")[1], "base64url").toString());
    if (!Number.isFinite(claims.exp)) throw new Error("Synthetic session has no expiry.");
    session = { ...value, expiresAt: claims.exp * 1000 };
    redactor.add(value.accessToken, value.refreshToken);
  };
  return {
    request,
    setSession,
    finishSeeding() {
      sealed = true;
    },
    async list(path) {
      const items = [];
      for (let page = 1; page <= 100; page++) {
        const value = await request(
          `${path}${path.includes("?") ? "&" : "?"}page=${page}&limit=100`,
        );
        items.push(...value.items);
        if (page >= value.pagination.totalPages) return items;
      }
      throw new Error("Synthetic list exceeded its pagination bound.");
    },
  };
}
