import { z } from "zod/v4";
import { unprocessable } from "@/common/errors";
import type { FetchJson, SourceJob } from "./types";

// Workday boards live at {tenant}.wd{N}.myworkdayjobs.com/{site}, so a slug is "tenant.wdN.site".
const WORKDAY_SLUG = /^([a-z0-9-]{1,40})\.(wd\d{1,2})\.([a-zA-Z0-9_-]{1,60})$/;
const PAGE = 20;
const MAX_PAGES = 100;
const DAY = 86400_000;

const page = z.object({
  total: z.number().default(0),
  jobPostings: z.array(
    z.object({
      // Some boards pad a page with empty placeholder postings.
      title: z.string().nullish(),
      externalPath: z.string().nullish(),
      locationsText: z.string().nullish(),
      postedOn: z.string().nullish(),
    }),
  ),
});

export function workdayBoard(slug: string) {
  const match = WORKDAY_SLUG.exec(slug);
  if (!match) return null;
  const [, tenant, instance, site] = match as unknown as [string, string, string, string];
  return { tenant, origin: `https://${tenant}.${instance}.myworkdayjobs.com`, site };
}

/** Workday only says "Posted 3 Days Ago"; "30+ Days Ago" is dated just past a month so it never looks new. */
export function workdayPostedAt(text: string | null | undefined, now = Date.now()): Date | null {
  const posted = text?.toLowerCase() ?? "";
  if (posted.includes("today")) return new Date(now);
  if (posted.includes("yesterday")) return new Date(now - DAY);
  const days = /(\d+)\+?\s*days? ago/.exec(posted);
  if (!days) return null;
  return new Date(now - (Number(days[1]) + (posted.includes("+") ? 1 : 0)) * DAY);
}

export async function workday(
  fetch: FetchJson,
  slug: string,
  company = slug,
): Promise<SourceJob[]> {
  const board = workdayBoard(slug);
  if (!board) throw unprocessable("Invalid Workday board slug.");
  const endpoint = `${board.origin}/wday/cxs/${board.tenant}/${board.site}/jobs`;
  const jobs: SourceJob[] = [];
  let total = 0;
  for (let index = 0; index < MAX_PAGES; index++) {
    const data = page.parse(
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appliedFacets: {},
          limit: PAGE,
          offset: index * PAGE,
          searchText: "",
        }),
      }),
    );
    // Later pages report total 0, so only the first page's count is trusted.
    if (index === 0) total = data.total;
    for (const job of data.jobPostings) {
      if (!job.title || !job.externalPath?.startsWith("/job/")) continue;
      const url = `${board.origin}/${board.site}${job.externalPath}`;
      const location = job.locationsText ?? "";
      jobs.push({
        title: job.title,
        company,
        // "3 Locations" names no place; leaving it blank keeps it out of wrong location matches.
        location: /^\d+ locations?$/i.test(location) ? "" : location,
        url,
        attributionUrl: url,
        description: "",
        postedAt: workdayPostedAt(job.postedOn),
      });
    }
    if (data.jobPostings.length < PAGE || (index + 1) * PAGE >= total) break;
  }
  return jobs;
}
