import { badRequest } from "@/common/errors";
import type { PrismaClient } from "@/generated/prisma/client";
import { canonicalizeIntakeUrl } from "@/modules/application/job-url";
import { allowedApplyUrl } from "@/modules/job-board/blocked-sites";
import { sourceVisibility } from "@/modules/job-listing/listing-visibility";
import { type AtsProvider, fetchAts } from "@/modules/job-sources/ats";
import type { FetchJson, SourceJob } from "@/modules/job-sources/types";

const hosts: Record<string, AtsProvider> = {
  "boards.greenhouse.io": "greenhouse",
  "job-boards.greenhouse.io": "greenhouse",
  "jobs.lever.co": "lever",
  "jobs.ashbyhq.com": "ashby",
};
const apiHosts = new Set(["boards-api.greenhouse.io", "api.lever.co", "api.ashbyhq.com"]);
export function intakeUrl(value: string) {
  const url = URL.parse(value);
  if (
    url?.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".local") ||
    /^[\d.]+$/.test(url.hostname) ||
    url.hostname.includes(":")
  )
    throw badRequest("Use one public HTTPS employer or job-board link without credentials.");
  return canonicalizeIntakeUrl(url.toString());
}
async function fetchIntakeJson(url: string) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    !apiHosts.has(parsed.hostname) ||
    parsed.port ||
    parsed.username ||
    parsed.password
  )
    throw badRequest("Unsupported public ATS endpoint.");
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw badRequest("Public ATS details are unavailable.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw badRequest("Empty public ATS response.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 2_000_000) {
        await reader.cancel();
        throw badRequest("Public ATS response exceeds the preparation limit.");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
export async function resolveIntake(
  prisma: PrismaClient,
  userId: string,
  value: string,
  fetchJson: FetchJson = fetchIntakeJson,
) {
  const canonicalUrl = intakeUrl(value);
  const source = await prisma.jobListingSource.findFirst({
    where: {
      AND: [
        sourceVisibility(userId),
        { listing: { status: "published" } },
        {
          OR: [{ url: canonicalUrl }, { applyUrl: canonicalUrl }, { attributionUrl: canonicalUrl }],
        },
      ],
    },
    include: { listing: true },
  });
  const target = intakeUrl(allowedApplyUrl(source?.applyUrl) ?? canonicalUrl);
  const url = new URL(target),
    provider = hosts[url.hostname],
    slug = url.pathname.split("/")[1];
  let resolved: SourceJob | null = null;
  if (provider && /^[A-Za-z0-9_-]{1,80}$/.test(slug ?? "")) {
    try {
      const jobs = await fetchAts(fetchJson, provider, slug, source?.listing.company ?? slug);
      resolved =
        jobs.find((job) =>
          [job.url, job.attributionUrl].some(
            (candidate) => canonicalizeIntakeUrl(candidate) === target,
          ),
        ) ?? null;
    } catch {
      /* A failed public lookup remains unresolved; it never authorizes model retries. */
    }
  }
  return {
    canonicalUrl: resolved ? intakeUrl(resolved.url) : target,
    resolved: !!resolved || !!allowedApplyUrl(source?.applyUrl),
    title: resolved?.title ?? source?.listing.title ?? "Job link awaiting preparation",
    company: resolved?.company ?? source?.listing.company ?? "",
    location: resolved?.location ?? source?.listing.location ?? null,
    description: resolved?.description ?? null,
    board: provider ?? source?.board ?? null,
  };
}
