import "reflect-metadata";
import { db } from "../src/common/database/prisma.client";
import { CompanyLogoService } from "../src/modules/job-listing/company-logo.service";
import { isGenericBoardLogo } from "../src/modules/job-listing/company-logo-metadata";
import { canonicalizeUrl } from "../src/modules/job-listing/dedupe";
import { JOB_FEED_CATALOG } from "../src/modules/job-sources/catalog";
import { fetchSourceJson, fetchSourceText } from "../src/modules/job-sources/http";
import { remoteOk } from "../src/modules/job-sources/public-feeds-remoteok";
import { weWorkRemotely } from "../src/modules/job-sources/public-feeds-wwr";

const apply = process.argv.includes("--apply");
const logos = new CompanyLogoService();
const counts = {
  scanned: 0,
  filled: 0,
  replaced: 0,
  cleared: 0,
  updated: 0,
  unavailable: 0,
  unchanged: 0,
  conflicts: 0,
};
const knownBroken = "https://www.coinbase.com/images/logo.png";
const primary = new Set(["coinbase", "reddit", "hugging face"]);

try {
  const stored = await db.jobListing.groupBy({ by: ["companyLogoUrl"] });
  const incorrect = stored.flatMap(({ companyLogoUrl }) =>
    companyLogoUrl && (companyLogoUrl === knownBroken || isGenericBoardLogo(companyLogoUrl))
      ? [companyLogoUrl]
      : [],
  );
  const listings = await db.jobListing.findMany({
    where: { OR: [{ companyLogoUrl: null }, { companyLogoUrl: { in: incorrect } }] },
    orderBy: { id: "asc" },
    take: 2000,
    select: {
      id: true,
      company: true,
      companyLogoUrl: true,
      sources: { select: { board: true, url: true, applyUrl: true, attributionUrl: true } },
    },
  });
  listings.sort(
    (a, b) =>
      Number(primary.has(b.company.toLowerCase())) - Number(primary.has(a.company.toLowerCase())),
  );
  const sources = new Set(
    listings.flatMap((listing) => listing.sources.map((source) => source.board)),
  );
  const providerLogos = new Map<string, string>();
  const feeds = [
    { board: "remoteok", read: () => remoteOk(fetchSourceJson) },
    { board: "weworkremotely", read: () => weWorkRemotely(fetchSourceText) },
  ];
  for (const feed of feeds) {
    if (!sources.has(feed.board)) continue;
    try {
      for (const job of await feed.read()) {
        if (job.companyLogoUrl)
          providerLogos.set(canonicalizeUrl(job.attributionUrl), job.companyLogoUrl);
      }
    } catch (error) {
      console.log(JSON.stringify({ provider: feed.board, metadataError: String(error) }));
    }
  }
  const established = await db.jobListing.findMany({
    where: {
      company: { in: [...new Set(listings.map((listing) => listing.company))] },
      companyLogoUrl: { not: null, notIn: incorrect },
    },
    distinct: ["company", "companyLogoUrl"],
    select: { company: true, companyLogoUrl: true },
  });
  const establishedLogos = new Map(
    established.map((row) => [row.company.toLowerCase(), row.companyLogoUrl]),
  );
  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      candidates: listings.length,
      boundedAt: 2000,
      providerLogos: providerLogos.size,
    }),
  );
  for (let offset = 0; offset < listings.length; offset += 4) {
    await Promise.all(
      listings.slice(offset, offset + 4).map(async (listing) => {
        const urls = listing.sources.flatMap((source) => [
          source.attributionUrl,
          source.applyUrl,
          source.url,
        ]);
        const supplied =
          urls
            .map((url) => url && providerLogos.get(canonicalizeUrl(url)))
            .find((url): url is string => !!url) ??
          establishedLogos.get(listing.company.toLowerCase());
        const board = JOB_FEED_CATALOG.find(
          (entry) =>
            entry.provider === "workable" &&
            entry.company.toLowerCase() === listing.company.toLowerCase(),
        );
        if (board) urls.unshift(`https://apply.workable.com/${encodeURIComponent(board.slug)}`);
        const logo = await logos.resolve({ companyLogoUrl: supplied, urls });
        if (logo) establishedLogos.set(listing.company.toLowerCase(), logo);
        counts.scanned++;
        if (!logo) counts.unavailable++;
        if (logo === listing.companyLogoUrl) {
          counts.unchanged++;
          return;
        }
        let changed = 1;
        if (apply) {
          const result = await db.jobListing.updateMany({
            where: { id: listing.id, companyLogoUrl: listing.companyLogoUrl },
            data: { companyLogoUrl: logo },
          });
          changed = result.count;
          counts.updated += changed;
          if (!changed) counts.conflicts++;
        }
        if (changed) {
          if (!logo) counts.cleared++;
          else if (listing.companyLogoUrl) counts.replaced++;
          else counts.filled++;
        }
      }),
    );
    if (offset % 100 === 0) console.log(JSON.stringify(counts));
  }
  const remaining = await db.jobListing.count({ where: { companyLogoUrl: null } });
  console.log(
    JSON.stringify({
      complete: true,
      mode: apply ? "apply" : "dry-run",
      remainingMissing: remaining,
      ...counts,
    }),
  );
} finally {
  await db.$disconnect();
}
