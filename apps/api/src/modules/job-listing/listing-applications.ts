import type { Prisma } from "@/generated/prisma/client";
import { canonicalizeJobUrl } from "@/modules/application/job-url";
import { canonicalizeUrl, type DedupeInput, dedupeKey } from "./dedupe";

type ApplicationPosting = DedupeInput & { url: string };
type ListingReader = Pick<Prisma.TransactionClient, "jobListing">;

export function listingApplicationIdentity(posting: ApplicationPosting) {
  return {
    listingKey: dedupeKey(posting),
    listingUrl: canonicalizeUrl(canonicalizeJobUrl(posting.url)),
  };
}

/** Exact posting identity only: fuzzy title matching could mark a different opening as applied. */
export async function listingApplicationData(db: ListingReader, posting: ApplicationPosting) {
  const identity = listingApplicationIdentity(posting);
  const urls = [...new Set([posting.url, canonicalizeUrl(posting.url), identity.listingUrl])];
  const source = await db.jobListing.findFirst({
    where: { sources: { some: { OR: [{ url: { in: urls } }, { applyUrl: { in: urls } }] } } },
    select: { id: true },
  });
  const listing =
    source ??
    (await db.jobListing.findUnique({
      where: { dedupeKey: identity.listingKey },
      select: { id: true },
    }));
  return { ...identity, listingId: listing?.id ?? null };
}

/** Also connects applications recorded before their posting arrived in the shared index. */
export async function linkListingApplications(
  db: Pick<Prisma.TransactionClient, "application">,
  listingId: string,
  key: string,
  urls: (string | null)[],
) {
  const canonicalUrls = urls
    .filter((url): url is string => Boolean(url))
    .map((url) => canonicalizeUrl(canonicalizeJobUrl(url)));
  await db.application.updateMany({
    where: { listingId: null, OR: [{ listingKey: key }, { listingUrl: { in: canonicalUrls } }] },
    data: { listingId },
  });
}
