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
// Also exempt because data.commoncrawl.org is Common Crawl's documented public download endpoint:
// robots.txt there blocks crawling, not downloads.
const COMMON_CRAWL = "data.commoncrawl.org";
const ROBOTS_EXEMPT = new Set([
  "api.smartrecruiters.com",
  "rbc.wd3.myworkdayjobs.com",
  COMMON_CRAWL,
]);
const ORACLE_API: Record<string, RegExp> = {
  "/hcmRestApi/resources/latest/recruitingCEJobRequisitions":
    /^onlyData=true&expand=requisitionList\.secondaryLocations&finder=findReqs;siteNumber=\w{1,40},limit=\d{1,3},offset=\d{1,6},sortBy=POSTING_DATES_DESC$/,
  "/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails":
    /^expand=all&onlyData=true&finder=ById;Id=%22\d{1,20}%22,siteNumber=\w{1,40}$/,
};
// A section's search page names the job board API's portal; job pages hold the descriptions.
const TALEO_PAGE = /^\/careersection\/[\w.-]{1,60}\/(jobsearch|jobdetail)\.ftl$/;
const TALEO_QUERY = { jobsearch: /^lang=en$/, jobdetail: /^job=\d{1,20}&lang=en$/ };
const TALEO_API = "/careersection/rest/jobboard/searchjobs";
const ICIMS_SEARCH = /^ss=1&in_iframe=1&pr=\d{1,3}$/;
const ICIMS_JOB = /^\/jobs\/\d{1,12}\/[^/]{1,200}\/job$/;
const WORKDAY_API = /^\/wday\/cxs\/[a-z0-9-]+\/([\w-]+)\/(jobs$|job\/)/;
const DAY = 86_400_000;
const MAX_BYTES = 20_000_000;
// One column chunk of a Common Crawl index row group.
const MAX_RANGE_BYTES = 80_000_000;
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
    host.endsWith(".oraclecloud.com") ||
    host.endsWith(".taleo.net") ||
    host.endsWith(".icims.com") ||
    host.endsWith(".recruitee.com") ||
    host.endsWith(".teamtailor.com") ||
    [
      "raw.githubusercontent.com",
      "yc-oss.github.io",
      "www.google.com",
      "jobs.ashbyhq.com",
      "jobs.lever.co",
      COMMON_CRAWL,
    ].includes(host)
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
  if (url.hostname === COMMON_CRAWL)
    return (
      !url.search &&
      (url.pathname === "/crawl-data/index.html" ||
        /^\/crawl-data\/CC-MAIN-\d{4}-\d{2}\/cc-index-table\.paths\.gz$/.test(url.pathname) ||
        /^\/cc-index\/table\/cc-main\/warc\/crawl=CC-MAIN-\d{4}-\d{2}\/subset=warc\/[\w.-]+\.parquet$/.test(
          url.pathname,
        ))
    );
  // A board's own page, read once for the company name in its title.
  if (url.hostname === "jobs.ashbyhq.com" || url.hostname === "jobs.lever.co")
    return !url.search && /^\/[\w.-]{1,80}$/.test(url.pathname);
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
  if (url.hostname.endsWith(".oraclecloud.com"))
    return ORACLE_API[url.pathname]?.test(url.search.slice(1)) ?? false;
  if (url.hostname.endsWith(".teamtailor.com")) return !url.search && url.pathname === "/jobs.rss";
  if (url.hostname.endsWith(".recruitee.com"))
    return !url.search && url.pathname === "/api/offers/";
  if (url.hostname.endsWith(".icims.com"))
    return url.pathname === "/jobs/search"
      ? ICIMS_SEARCH.test(url.search.slice(1))
      : ICIMS_JOB.test(url.pathname) && url.search === "?in_iframe=1";
  if (url.hostname.endsWith(".taleo.net")) {
    if (url.pathname === TALEO_API) return /^lang=en&portal=\d{1,20}$/.test(url.search.slice(1));
    const page = TALEO_PAGE.exec(url.pathname)?.[1] as keyof typeof TALEO_QUERY | undefined;
    return !!page && TALEO_QUERY[page].test(url.search.slice(1));
  }
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

/**
 * One checked request: allowed endpoint, robots.txt, per-host pacing, and backoff. A 429 pauses
 * the whole host; Common Crawl's 503s are retried slowly, since that server gets overloaded.
 */
async function request(url: string, init: RequestInit, accept: string): Promise<Response> {
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
  const overloadRetries = host === COMMON_CRAWL ? 6 : 0;
  let retryAfterMs = 0;
  for (let attempt = 0; attempt < 3 + overloadRetries; attempt++) {
    const slot = Math.max(Date.now(), nextRequest.get(host) ?? 0);
    nextRequest.set(host, slot + gap);
    await Bun.sleep(Math.max(0, slot - Date.now()));
    const headers = new Headers(init.headers);
    headers.set("User-Agent", "OpenApply/1.0 (+https://github.com/Jarvuslin/OpenApply)");
    if (!headers.has("Accept"))
      headers.set(
        "Accept",
        host === "www.google.com" ||
          SUCCESSFACTORS_SITES.has(host) ||
          host === "jobs.ashbyhq.com" ||
          host === "jobs.lever.co"
          ? "text/html"
          : accept,
      );
    const response = await fetch(url, {
      ...init,
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(host === COMMON_CRAWL ? 120_000 : 30_000),
    });
    const overloaded = response.status === 503 && attempt < overloadRetries;
    if (response.status === 429 || overloaded) {
      const seconds = Number(response.headers.get("retry-after"));
      await response.body?.cancel();
      const base = overloaded ? 15_000 * 2 ** attempt : 1000 * 4 ** attempt;
      retryAfterMs = Math.max(base, Number.isFinite(seconds) ? seconds * 1000 : 0);
      // Every request to this host waits, not only this one, so other boards on it back off too.
      nextRequest.set(
        host,
        Math.max(
          nextRequest.get(host) ?? 0,
          Date.now() + Math.min(retryAfterMs, overloaded ? 600_000 : 60_000),
        ),
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
    return response;
  }
  throw new SourceResponseError(
    "Discovery source rate limit reached. Try again later.",
    429,
    retryAfterMs,
  );
}

/** The body, refusing anything over `limit` bytes as it streams. */
async function readBody(response: Response, limit: number): Promise<Uint8Array[]> {
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new SourceResponseError("Discovery response is too large.", response.status, 0, true);
  }
  const reader = response.body?.getReader();
  if (!reader) return [];
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new SourceResponseError("Discovery response is too large.", response.status, 0, true);
      }
      chunks.push(value);
    }
    return chunks;
  } finally {
    reader.releaseLock();
  }
}

// Every Workday tenant is its own host, so per-host pacing alone would let thousands run at once.
// Across all of them: at most 4 requests in flight, started at least 250 ms apart (about 4 a second).
const WORKDAY_IN_FLIGHT = 4;
const WORKDAY_GAP_MS = 250;
let workdayActive = 0;
let workdayNext = 0;
const workdayWaiting: (() => void)[] = [];

async function workdaySlot(host: string): Promise<() => void> {
  if (!host.endsWith(".myworkdayjobs.com")) return () => {};
  while (workdayActive >= WORKDAY_IN_FLIGHT)
    await new Promise<void>((resolve) => workdayWaiting.push(resolve));
  workdayActive++;
  const slot = Math.max(Date.now(), workdayNext);
  workdayNext = slot + WORKDAY_GAP_MS;
  await Bun.sleep(Math.max(0, slot - Date.now()));
  return () => {
    workdayActive--;
    workdayWaiting.shift()?.();
  };
}

export async function fetchSourceText(
  url: string,
  init: RequestInit = {},
  accept = "application/rss+xml, application/xml, text/xml",
): Promise<string> {
  const release = await workdaySlot(URL.parse(url)?.hostname ?? "");
  try {
    const chunks = await readBody(await request(url, init, accept), MAX_BYTES);
    const decoder = new TextDecoder();
    return (
      chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join("") + decoder.decode()
    );
  } finally {
    release();
  }
}

/** Bytes `start` to `end` (exclusive) of a file, and the file's full size, by an HTTP range request. */
export async function fetchSourceRange(
  url: string,
  start: number,
  end: number,
): Promise<{ bytes: ArrayBuffer; size: number }> {
  const response = await request(
    url,
    { headers: { Range: `bytes=${start}-${end - 1}` } },
    "application/octet-stream",
  );
  const size = Number(/\/(\d+)$/.exec(response.headers.get("content-range") ?? "")?.[1]);
  if (response.status !== 206 || !Number.isFinite(size)) {
    await response.body?.cancel();
    throw new SourceResponseError("Discovery source ignored the byte range.", response.status);
  }
  const chunks = await readBody(response, MAX_RANGE_BYTES);
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes: bytes.buffer, size };
}

/** True when a response was over the size cap, so a smaller request may still work. */
export function tooLarge(error: unknown): boolean {
  return error instanceof SourceResponseError && error.tooLarge;
}
