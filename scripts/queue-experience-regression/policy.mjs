export function queueExperienceRequestAllowed(method, address, body, config) {
  let url;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  if (
    ![config.webUrl, config.apiUrl, config.companionUrl].includes(url.origin) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.hash
  )
    return false;
  if (new Set(url.searchParams.keys()).size !== [...url.searchParams].length) return false;
  const p = url.pathname;
  if (url.origin === config.webUrl) {
    if (!["GET", "HEAD"].includes(method) || p.startsWith("/api/")) return false;
    return !p.startsWith("/__nextjs_") || (p === "/__nextjs_font/geist-latin.woff2" && !url.search);
  }
  if (url.origin === config.companionUrl) {
    if (!["GET", "OPTIONS"].includes(method)) return false;
    if (["/queue/status", "/healthz"].includes(p)) return !url.search;
    return (
      config.frameAllowed &&
      config.workers.some(
        (w) =>
          p === `/queue/workers/${w.browserSessionId}/frame` &&
          [...url.searchParams.keys()].sort().join(",") === "executionId,workItemId" &&
          url.searchParams.get("executionId") === w.executionId &&
          url.searchParams.get("workItemId") === w.workItemId,
      )
    );
  }
  const simpleReads = [
    "/api/auth/me",
    "/api/auth/options",
    "/api/user",
    "/api/resumes",
    "/api/locations",
    "/api/runtime/presence",
    "/api/needs-you/count",
    "/api/needs-you/events",
    "/api/workspace/events",
    "/api/work-queue/events",
    "/api/work-queue/summary",
    "/api/work-queue/limits",
    "/api/work-queue/estimate",
    "/api/pilot",
    "/api/pilot/events",
    "/api/email/account",
    `/api/applied/${config.applicationId}`,
    `/api/campaigns/${config.campaignId}`,
    `/api/campaigns/${config.campaignId}/events`,
    `/api/campaigns/${config.campaignId}/jobs/reasons`,
    `/api/campaigns/${config.campaignId}/jobs/${config.controlJobKey}`,
    `/api/campaigns/${config.campaignId}/jobs/${config.controlJobKey}/submission-attempt`,
    `/api/jobs/${config.controlJobId}/questions`,
    ...config.itemIds.map((id) => `/api/work-queue/${id}`),
  ];
  const pageReads = [
    "/api/work-queue",
    "/api/needs-you",
    `/api/campaigns/${config.campaignId}/jobs`,
  ];
  const paged =
    pageReads.includes(p) &&
    [...url.searchParams].every(
      ([key, value]) =>
        (["page", "limit"].includes(key) && /^[1-9]\d{0,2}$/.test(value)) ||
        (key === "kind" &&
          p === "/api/needs-you" &&
          ["all", "application", "operational", "collection"].includes(value)) ||
        (key === "state" &&
          p === "/api/work-queue" &&
          ["queued", "paused", "submitted", "needs_user", "filling"].includes(value)),
    );
  const pdf =
    p === `/api/applied/${config.applicationId}/submitted-resume` &&
    [...url.searchParams.keys()].join(",") === "sha256" &&
    url.searchParams.get("sha256") === config.pdfSha256;
  const preview =
    p === `/api/jobs/${config.controlJobId}/preparation` && url.search === "?mode=preview";
  if (["GET", "HEAD"].includes(method))
    return (simpleReads.includes(p) && !url.search) || paged || pdf || preview;
  const mutations = [
    "/api/auth/login",
    "/api/auth/refresh",
    "/api/auth/logout",
    `/api/work-queue/${config.controlId}/control`,
  ];
  if (config.frameAllowed) mutations.push("/api/auth/tokens/terminal");
  if (method === "OPTIONS")
    return (
      !url.search && (mutations.includes(p) || simpleReads.includes(p) || pageReads.includes(p))
    );
  if (method !== "POST" || !mutations.includes(p) || url.search) return false;
  if (["/api/auth/refresh", "/api/auth/logout", "/api/auth/tokens/terminal"].includes(p))
    return body === undefined || body === null || body === "" || body === "null";
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const keys = Object.keys(parsed).sort().join(",");
  if (p === "/api/auth/login")
    return (
      keys === "email,password" &&
      parsed.email === config.loginEmail &&
      parsed.password === config.password
    );
  return keys === "action" && ["pause", "resume", "stop"].includes(parsed.action);
}
