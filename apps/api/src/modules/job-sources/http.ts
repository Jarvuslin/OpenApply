import { badRequest } from "@/common/errors";
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
const nextRequest = new Map<string, number>();

function supportedEndpoint(url: URL): boolean {
  if (url.hostname === "raw.githubusercontent.com") {
    return (
      !url.search &&
      !url.hash &&
      [
        "/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json",
        "/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json",
        "/negarprh/Canadian-Tech-Internships-2027/main/README.md",
      ].includes(url.pathname)
    );
  }
  if (url.hostname === "yc-oss.github.io")
    return !url.search && !url.hash && url.pathname === "/api/companies/hiring.json";
  if (url.hostname === "www.google.com") {
    return /^\/about\/careers\/applications\/jobs\/results\/(?:\d+-[a-z0-9]+(?:-[a-z0-9]+)*)?$/.test(
      url.pathname,
    );
  }
  if (PHENOM_SITES.has(url.hostname))
    return !url.search && !url.hash && url.pathname === "/widgets";
  if (SUCCESSFACTORS_SITES.has(url.hostname)) return !url.hash && url.pathname === "/search/";
  if (url.hostname.endsWith(".myworkdayjobs.com"))
    return !url.search && !url.hash && /^\/wday\/cxs\/[a-z0-9-]+\/[\w-]+\/jobs$/.test(url.pathname);
  return HOSTS.has(url.hostname);
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
    throw badRequest("Unsupported discovery endpoint.");
  for (let attempt = 0; attempt < 3; attempt++) {
    const slot = Math.max(Date.now(), nextRequest.get(parsed.hostname) ?? 0);
    nextRequest.set(
      parsed.hostname,
      slot + (parsed.hostname === "hacker-news.firebaseio.com" ? 50 : 500),
    );
    await Bun.sleep(Math.max(0, slot - Date.now()));
    const headers = new Headers(init.headers);
    headers.set("User-Agent", "OpenApply/1.0 (+https://github.com/Jarvuslin/OpenApply)");
    if (!headers.has("Accept"))
      headers.set(
        "Accept",
        parsed.hostname === "www.google.com" || SUCCESSFACTORS_SITES.has(parsed.hostname)
          ? "text/html"
          : accept,
      );
    const response = await fetch(url, {
      ...init,
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 429 && attempt < 2) {
      const seconds = Number(response.headers.get("retry-after"));
      await response.body?.cancel();
      await Bun.sleep(
        Math.min(
          10_000,
          Math.max(1000 * 2 ** attempt, Number.isFinite(seconds) ? seconds * 1000 : 0),
        ),
      );
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw badRequest(`Discovery source ${parsed.hostname} returned HTTP ${response.status}.`);
    }
    if (Number(response.headers.get("content-length")) > 20_000_000) {
      await response.body?.cancel();
      throw badRequest("Discovery response is too large.");
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
        if (bytes > 20_000_000) {
          await reader.cancel();
          throw badRequest("Discovery response is too large.");
        }
        chunks.push(decoder.decode(value, { stream: true }));
      }
      chunks.push(decoder.decode());
      return chunks.join("");
    } finally {
      reader.releaseLock();
    }
  }
  throw badRequest("Discovery source rate limit reached. Try again later.");
}
