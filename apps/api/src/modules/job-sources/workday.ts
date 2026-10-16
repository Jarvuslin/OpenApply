import { z } from "zod/v4";
import { unprocessable } from "@/common/errors";
import { withDetails } from "./details";
import { familyIsNonTech } from "./tech-filter";
import {
  type BoardOptions,
  type BoardResult,
  boardResult,
  type FetchJson,
  plainText,
  requisition,
  requisitionFrom,
  type SourceJob,
} from "./types";

// Workday boards live at {tenant}.wd{N}.myworkdayjobs.com/{site}, so a slug is "tenant.wdN.site".
const WORKDAY_SLUG = /^([a-z0-9-]{1,40})\.(wd\d{1,2})\.([a-zA-Z0-9_-]{1,60})$/;
const PAGE = 20;
const MAX_PAGES = 250;
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
      bulletFields: z.array(z.string()).nullish(),
    }),
  ),
  facets: z
    .array(
      z.object({
        facetParameter: z.string(),
        values: z.array(z.object({ descriptor: z.string(), id: z.string() })).catch([]),
      }),
    )
    .catch([]),
});
const detail = z.object({
  jobPostingInfo: z.object({
    jobDescription: z.string().nullish(),
    startDate: z.string().nullish(),
    jobReqId: z.string().nullish(),
    location: z.string().nullish(),
    additionalLocations: z.array(z.string()).nullish(),
  }),
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

/**
 * The job families to request so clearly non-tech ones are never fetched: every family except
 * those like "Retail Sales & Service". Empty when the board has no family facet to narrow by.
 */
export function techFamilies(facets: z.infer<typeof page>["facets"]): Record<string, string[]> {
  const facet =
    facets.find((entry) => entry.facetParameter === "jobFamilyGroup") ??
    facets.find((entry) => entry.facetParameter === "jobFamily");
  if (!facet) return {};
  const kept = facet.values.filter((value) => !familyIsNonTech(value.descriptor));
  if (kept.length === 0 || kept.length === facet.values.length) return {};
  return { [facet.facetParameter]: kept.map((value) => value.id) };
}

export async function workday(
  fetch: FetchJson,
  slug: string,
  company = slug,
  options: BoardOptions = {},
): Promise<BoardResult> {
  const board = workdayBoard(slug);
  if (!board) throw unprocessable("Invalid Workday board slug.");
  const api = `${board.origin}/wday/cxs/${board.tenant}/${board.site}`;
  const search = (appliedFacets: Record<string, string[]>, limit: number, offset: number) =>
    fetch(`${api}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appliedFacets, limit, offset, searchText: "" }),
    });
  // One posting is enough to read the board's job families.
  const families = options.techOnly ? techFamilies(page.parse(await search({}, 1, 0)).facets) : {};
  const jobs: SourceJob[] = [];
  // With families applied, this is the filtered total, so a filtered board is not "truncated".
  let total = 0;
  let seen = 0;
  let limited = false;
  for (let index = 0; ; index++) {
    if (index === MAX_PAGES) {
      limited = true;
      break;
    }
    const data = page.parse(await search(families, PAGE, index * PAGE));
    // Later pages report total 0, so only the first page's count is trusted.
    if (index === 0) total = data.total;
    seen += data.jobPostings.length;
    for (const job of data.jobPostings) {
      if (!job.title || !job.externalPath?.startsWith("/job/")) continue;
      const location = job.locationsText ?? "";
      jobs.push({
        title: job.title,
        company,
        // "3 Locations" names no place; the detail page lists them.
        location: /^\d+ locations?$/i.test(location) ? "" : location,
        url: `${board.origin}/${board.site}${job.externalPath}`,
        attributionUrl: `${board.origin}/${board.site}${job.externalPath}`,
        externalId: job.externalPath.split("/").pop(),
        requisitionId: requisition(job.bulletFields?.[0]),
        description: "",
        postedAt: workdayPostedAt(job.postedOn),
      });
    }
    if (data.jobPostings.length < PAGE || (index + 1) * PAGE >= total) break;
  }
  await withDetails(jobs, options, async (listed) => {
    const path = listed.url.slice(`${board.origin}/${board.site}`.length);
    const info = detail.parse(await fetch(`${api}${path}`)).jobPostingInfo;
    const description = plainText(info.jobDescription ?? "");
    const places = [info.location, ...(info.additionalLocations ?? [])].filter(
      (place): place is string => !!place,
    );
    // `startDate` is the date the posting went live, exact where the list only says "3 Days Ago".
    const started = info.startDate ? new Date(`${info.startDate}T00:00:00Z`) : null;
    return {
      description,
      ...(started && Number.isFinite(started.getTime()) && { postedAt: started }),
      ...(!listed.location && places.length > 0 && { location: places.join("; ") }),
      ...(!listed.requisitionId && {
        requisitionId: requisition(info.jobReqId) ?? requisitionFrom(description),
      }),
    };
  });
  return boardResult(jobs, total, seen, limited);
}
