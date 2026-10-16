import { ErrorCodes, HttpError } from "@/common/errors";
import { type RobotsRules, robotsAllows, rulesForStatus } from "./robots";
import type { FetchJson } from "./types";

const HOSTS = new Set([
  "api.ashbyhq.com",
  "boards-api.greenhouse.io",
  "api.lever.co",
  "api.smartrecruiters.com",
  "apply.workable.com",
  "api.apify.com",
  "serpapi.com",
  "remoteok.com",
  "hacker-news.firebaseio.com",
  "weworkremotely.com",
  "hiringcafe.com",
]);
// Phenom and SuccessFactors sites sit on employer domains, so each one is listed by hand.
const SUCCESSFACTORS_SITES = new Set([
  "jobs.scotiabank.com",
  "jobs.rogers.com",
  "careers.telus.com",
]);
const PHENOM_SITES = new Set(["jobs.bell.ca", "careers.opentext.com"]);
// OpenApply runs as a personal-use tool, so these hosts are exempt from robots.txt for personal
// use; every other host is checked. SmartRecruiters' robots.txt admits only LinkedInBot to its
// public posting API, and RBC's disallows its main Workday career site (RBCGLOBAL1).
const ROBOTS_EXEMPT = new Set(["api.smartrecruiters.com", "rbc.wd3.myworkdayjobs.com"]);
const WORKDAY_API = /^\/wday\/cxs\/[a-z0-9-]+\/([\w-]+)\/(jobs$|job\/)/;
const DAY = 86_400_000;
const MAX_BYTES = 20_000_000;
const nextRequest = new Map<string, number>();
const robotsCache = new Map<string, { rules: RobotsRules; until: number }>();

/** A source answered with an error status, refused by size, or kept rate-limiting us. */
export class SourceResponseError extends HttpError {
  constructor(
    message: string,
    readonly upstreamStatus: number | null,
    readonly retryAfterMs = 0,
    readonly tooLarge = false,
  ) {
    super(ErrorCodes.INVALID_REQUEST, message, 400);
  }
}

function knownHost(host: string): boolean {
  return (
    HOSTS.has(host) ||
    SUCCESSFACTORS_SITES.has(host) ||
    PHENOM_SITES.has(host) ||
    host.endsWith(".myworkdayjobs.com") ||
    ["raw.githubusercontent.com", "yc-oss.github.io", "www.google.com"].includes(host)
  );
}

function supportedEndpoint(url: URL): boolean {
  if (url.hash) return false;
  if (url.pathname === "/robots.txt") return !url.search && knownHost(url.hostname);
  if (url.hostname === "raw.githubusercontent.com") {
    return (
      !url.search &&
      [
        "/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json",
        "/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json",
        "/negarprh/Canadian-Tech-Internships-2027/main/README.md",
      ].includes(url.pathname)
    );
  }
  if (url.hostname === "yc-oss.github.io")
    return !url.search && url.pathname === "/api/companies/hiring.json";
  if (url.hostname === "www.google.com") {
    return /^\/about\/careers\/applications\/jobs\/results\/(?:\d+-[a-z0-9]+(?:-[a-z0-9]+)*)?$/.test(
      url.pathname,
    );
  }
  if (PHENOM_SITES.has(url.hostname)) return !url.search && url.pathname === "/widgets";
  if (SUCCESSFACTORS_SITES.has(url.hostname))
    return url.pathname === "/search/" || /^\/(?:[\w-]+\/)?job\/[^?#]+$/.test(url.pathname);
  if (url.hostname.endsWith(".myworkdayjobs.com"))
    return !url.search && WORKDAY_API.test(url.pathname);
  return HOSTS.has(url.hostname);
}

async function robotsFor(host: string): Promise<RobotsRules> {
  const cached = robotsCache.get(host);
  if (cached && cached.until > Date.now()) return cached.rules;
  let status = 0;
  let text = "";
  try {
    const response = await fetch(`https://${host}/robots.txt`, {
      headers: { "User-Agent": "OpenApply/1.0 (+https://github.com/Jarvuslin/OpenApply)" },
      signal: AbortSignal.timeout(30_000),
    });
    status = response.status;
    text = (await response.text()).slice(0, 500_000);
  } catch {
    // Unreachable is treated like a server error below: no request until it can be read.
  }
  const rules = rulesForStatus(status, text);
  if (!rules)
    throw new SourceResponseError(
      `Could not read robots.txt for ${host}; try again later.`,
      status,
    );
  robotsCache.set(host, { rules, until: Date.now() + DAY });
  return rules;
}

/** A request carrying the user's own API key: an Authorization header or an `api_key` parameter. */
function authenticated(url: URL, init: RequestInit): boolean {
  return new Headers(init.headers).has("authorization") || url.searchParams.has("api_key");
}

/** Whether robots.txt lets OpenApply request this URL. Workday is also checked by its site path. */
async function robotsPermit(url: URL, init: RequestInit): Promise<RobotsRules | null> {
  // robots.txt governs crawling. A paid API we call as a customer with the user's own key, such
  // as Apify or SerpApi, is not crawling, so its robots.txt does not apply.
  if (authenticated(url, init)) return null;
  if (ROBOTS_EXEMPT.has(url.hostname) || url.pathname === "/robots.txt") return null;
  const rules = await robotsFor(url.hostname);
  const site = WORKDAY_API.exec(url.pathname)?.[1];
  // A Workday tenant blocks a career site by its path, such as "Disallow: /RBCGLOBAL1/"; the
  // site id is case-insensitive, so the check is too.
  if (
    !robotsAllows(rules, `${url.pathname}${url.search}`) ||
    (site && !robotsAllows(rules, `/${site}/`, true))
  )
    throw new SourceResponseError(`robots.txt on ${url.hostname} disallows this page.`, null);
  return rules;
}

export const fetchSourceJson: FetchJson = async (url, init = {}) =>
  JSON.parse(await fetchSourceText(url, init, "application/json")) as unknown;

export async function fetchSourceText(
  url: string,
  init: RequestInit = {},
  accept = "application/rss+xml, application/xml, text/xml",
): Promise<string> {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    !supportedEndpoint(parsed) ||
    parsed.username ||
    parsed.password ||
    parsed.port
  )
    throw new SourceResponseError("Unsupported discovery endpoint.", null);
  const rules = await robotsPermit(parsed, init);
  const host = parsed.hostname;
  const gap = Math.max(
    host === "hacker-news.firebaseio.com" ? 50 : 500,
    (rules?.crawlDelay ?? 0) * 1000,
  );
  let retryAfterMs = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const slot = Math.max(Date.now(), nextRequest.get(host) ?? 0);
    nextRequest.set(host, slot + gap);
    await Bun.sleep(Math.max(0, slot - Date.now()));
    const headers = new Headers(init.headers);
    headers.set("User-Agent", "OpenApply/1.0 (+https://github.com/Jarvuslin/OpenApply)");
    if (!headers.has("Accept"))
      headers.set(
        "Accept",
        host === "www.google.com" || SUCCESSFACTORS_SITES.has(host) ? "text/html" : accept,
      );
    const response = await fetch(url, {
      ...init,
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 429) {
      const seconds = Number(response.headers.get("retry-after"));
      await response.body?.cancel();
      retryAfterMs = Math.max(1000 * 4 ** attempt, Number.isFinite(seconds) ? seconds * 1000 : 0);
      // Every request to this host waits, not only this one, so other boards on it back off too.
      nextRequest.set(
        host,
        Math.max(nextRequest.get(host) ?? 0, Date.now() + Math.min(retryAfterMs, 60_000)),
      );
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new SourceResponseError(
        `Discovery source ${host} returned HTTP ${response.status}.`,
        response.status,
      );
    }
    if (Number(response.headers.get("content-length")) > MAX_BYTES) {
      await response.body?.cancel();
      throw new SourceResponseError("Discovery response is too large.", response.status, 0, true);
    }
    const reader = response.body?.getReader();
    if (!reader) return "";
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) {
          await reader.cancel();
          throw new SourceResponseError(
            "Discovery response is too large.",
            response.status,
            0,
            true,
          );
        }
        chunks.push(decoder.decode(value, { stream: true }));
      }
      chunks.push(decoder.decode());
      return chunks.join("");
    } finally {
      reader.releaseLock();
    }
  }
  throw new SourceResponseError(
    "Discovery source rate limit reached. Try again later.",
    429,
    retryAfterMs,
  );
}

/** True when a response was over the size cap, so a smaller request may still work. */
export function tooLarge(error: unknown): boolean {
  return error instanceof SourceResponseError && error.tooLarge;
}
