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
]);
const nextRequest = new Map<string, number>();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const fetchSourceJson: FetchJson = async (url, init = {}) => {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    !HOSTS.has(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.port
  )
    throw badRequest("Unsupported discovery endpoint.");
  for (let attempt = 0; attempt < 3; attempt++) {
    const slot = Math.max(Date.now(), nextRequest.get(parsed.hostname) ?? 0);
    nextRequest.set(parsed.hostname, slot + 500);
    await sleep(Math.max(0, slot - Date.now()));
    const headers = new Headers(init.headers);
    headers.set("User-Agent", "OpenApply/1.0 (+https://github.com/Jarvuslin/OpenApply)");
    headers.set("Accept", "application/json");
    const response = await fetch(url, {
      ...init,
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 429 && attempt < 2) {
      const seconds = Number(response.headers.get("retry-after"));
      await response.body?.cancel();
      await sleep(
        Math.min(
          10_000,
          Math.max(1000 * 2 ** attempt, Number.isFinite(seconds) ? seconds * 1000 : 0),
        ),
      );
      continue;
    }
    if (!response.ok)
      throw badRequest(`Discovery source ${parsed.hostname} returned HTTP ${response.status}.`);
    const text = await response.text();
    if (text.length > 20_000_000) throw badRequest("Discovery response is too large.");
    return JSON.parse(text) as unknown;
  }
  throw badRequest("Discovery source rate limit reached. Try again later.");
};
