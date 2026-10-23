import "reflect-metadata";
import { db } from "../src/common/database/prisma.client";
import { buildListingDraft } from "../src/modules/job-listing/listing-draft";
import { greenhouse } from "../src/modules/job-sources/greenhouse";
import { fetchSourceJson } from "../src/modules/job-sources/http";

const apply = process.argv.includes("--apply");
try {
  const sources = await db.jobListingSource.findMany({
    where: {
      url: "https://mongodb.com/careers/job",
      listing: { company: "MongoDB" },
    },
    select: { id: true, url: true, listing: { select: { id: true, dedupeKey: true, slug: true } } },
  });
  if (sources.length > 1) throw new Error("Unexpected duplicate source identity.");
  const jobs = sources.length
    ? (await greenhouse(fetchSourceJson, "mongodb", "MongoDB", { detailBudget: 0 })).jobs
    : [];
  for (const source of sources) {
    const matches = jobs
      .map((job) =>
        buildListingDraft({
          ...job,
          publicFeed: true,
          board: "greenhouse",
          applyUrl: job.url,
        }),
      )
      .filter((draft) => draft?.dedupeKey === source.listing.dedupeKey);
    if (matches.length !== 1 || !matches[0])
      throw new Error(
        "Original posting is not uniquely present in the current MongoDB feed; no repair performed.",
      );
    const draft = matches[0];
    console.log(
      JSON.stringify({
        apply,
        listingId: source.listing.id,
        previousUrl: source.url,
        repairedUrl: draft.url,
        title: draft.title,
        location: draft.location,
      }),
    );
    if (!apply) continue;
    const {
      board,
      url,
      applyUrl,
      attributionUrl,
      resolutionConfidence,
      companyLogoUrl: _logo,
      ...metadata
    } = draft;
    await db.$transaction(async (tx) => {
      // Derived-only repair: saved jobs and application history require a separate reviewed repair.
      const listing = await tx.jobListing.updateMany({
        where: {
          id: source.listing.id,
          dedupeKey: draft.dedupeKey,
          savedBy: { none: {} },
          applications: { none: {} },
        },
        data: metadata,
      });
      if (listing.count !== 1)
        throw new Error("Listing acquired private activity or changed; repair cancelled.");
      const changed = await tx.jobListingSource.updateMany({
        where: { id: source.id, url: source.url, listingId: source.listing.id },
        data: {
          board,
          url,
          applyUrl,
          attributionUrl,
          resolutionConfidence,
          postedAt: draft.postedAt,
        },
      });
      if (changed.count !== 1) throw new Error("Source changed; repair cancelled.");
    });
  }
  console.log(JSON.stringify({ complete: true, apply, repaired: apply ? sources.length : 0 }));
} finally {
  await db.$disconnect();
}
