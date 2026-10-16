import "reflect-metadata";
import { jobLevelFromTitle } from "@openapply/contracts/job-listing";
import { db } from "../src/common/database/prisma.client";
import { listingApplicationData } from "../src/modules/job-listing/listing-applications";
import { listingCountries } from "../src/modules/job-listing/listing-countries";

const counts = { listings: 0, applications: 0, linked: 0 };
try {
  let cursor: string | undefined;
  for (;;) {
    const rows = await db.jobListing.findMany({
      where: {
        OR: [{ countries: { isEmpty: true } }, { level: "unknown" }],
        ...(cursor && { id: { gt: cursor } }),
      },
      orderBy: { id: "asc" },
      take: 100,
      select: { id: true, location: true, countries: true, title: true, level: true },
    });
    if (!rows.length) break;
    cursor = rows.at(-1)?.id;
    for (const row of rows) {
      await db.jobListing.update({
        where: { id: row.id },
        data: {
          ...(!row.countries.length && { countries: listingCountries(row.location) }),
          ...(row.level === "unknown" && { level: jobLevelFromTitle(row.title) }),
        },
      });
      counts.listings++;
    }
  }
  cursor = undefined;
  for (;;) {
    const rows: {
      id: string;
      url: string;
      title: string;
      company: string;
      location: string | null;
    }[] = await db.application.findMany({
      where: { listingId: null, ...(cursor && { id: { gt: cursor } }) },
      orderBy: { id: "asc" },
      take: 100,
      select: { id: true, url: true, title: true, company: true, location: true },
    });
    if (!rows.length) break;
    cursor = rows.at(-1)?.id;
    for (const row of rows) {
      const data = await listingApplicationData(db, row);
      await db.application.update({ where: { id: row.id }, data });
      counts.applications++;
      if (data.listingId) counts.linked++;
    }
  }
} finally {
  await db.$disconnect();
}
console.log(JSON.stringify({ complete: true, ...counts }));
