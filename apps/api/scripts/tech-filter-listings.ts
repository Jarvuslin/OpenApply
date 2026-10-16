import "reflect-metadata";
import { db } from "../src/common/database/prisma.client";
import { classifyJob } from "../src/modules/job-sources/tech-filter";

// How the tech filter splits the current index, by source. With --apply, non-tech listings are
// deleted, except any a user saved or applied to.
const apply = process.argv.includes("--apply");
const SAMPLE = 30;
const BATCH = 1000;
try {
  const listings = await db.jobListing.findMany({
    where: { status: "published" },
    select: {
      id: true,
      title: true,
      company: true,
      descriptionExcerpt: true,
      sources: { select: { board: true } },
    },
  });
  const bySource = new Map<string, { kept: number; dropped: number; unsure: number }>();
  const dropped: { id: string; label: string }[] = [];
  let unsure = 0;
  for (const listing of listings) {
    const verdict = classifyJob(listing.title, listing.descriptionExcerpt ?? "");
    if (verdict === "non_tech")
      dropped.push({ id: listing.id, label: `${listing.title} — ${listing.company}` });
    if (verdict === "unsure") unsure++;
    for (const board of new Set(listing.sources.map((source) => source.board ?? "unknown"))) {
      const counts = bySource.get(board) ?? { kept: 0, dropped: 0, unsure: 0 };
      if (verdict === "non_tech") counts.dropped++;
      else counts.kept++;
      if (verdict === "unsure") counts.unsure++;
      bySource.set(board, counts);
    }
  }
  console.log(
    JSON.stringify({
      listings: listings.length,
      kept: listings.length - dropped.length,
      dropped: dropped.length,
      keptBecauseUnsure: unsure,
    }),
  );
  for (const [board, counts] of [...bySource].sort(
    (a, b) => b[1].kept + b[1].dropped - (a[1].kept + a[1].dropped),
  ))
    console.log(
      `${board}\tkept ${counts.kept} (unsure ${counts.unsure})\tdropped ${counts.dropped}`,
    );
  if (apply) {
    let removed = 0;
    for (let start = 0; start < dropped.length; start += BATCH) {
      const result = await db.jobListing.deleteMany({
        where: {
          id: { in: dropped.slice(start, start + BATCH).map((listing) => listing.id) },
          savedBy: { none: {} },
          applications: { none: {} },
        },
      });
      removed += result.count;
    }
    console.log(`\nRemoved ${removed}; kept ${dropped.length - removed} saved or applied.`);
  } else {
    const sample = [...dropped];
    console.log(`\n${SAMPLE} random dropped titles:`);
    for (let index = 0; index < SAMPLE && sample.length; index++)
      console.log(`- ${sample.splice(Math.floor(Math.random() * sample.length), 1)[0]?.label}`);
  }
} finally {
  await db.$disconnect();
}
