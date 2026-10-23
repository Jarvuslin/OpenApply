import { z } from "zod/v4";
import {
  type BoardResult,
  boardResult,
  type FetchJson,
  postedAt,
  requisition,
  type SourceJob,
} from "./types";

const PAGE = 100;
const MAX_PAGES = 50;

const feed = z.object({
  totalFound: z.number().nullish(),
  content: z.array(
    z.object({
      id: z.union([z.string(), z.number()]),
      name: z.string(),
      refNumber: z.string().nullish(),
      releasedDate: z.string().nullish(),
      location: z
        .object({
          city: z.string().optional(),
          region: z.string().optional(),
          country: z.string().optional(),
          remote: z.boolean().optional(),
        })
        .default({}),
    }),
  ),
});
export async function smartrecruiters(
  fetch: FetchJson,
  slug: string,
  company = slug,
): Promise<BoardResult> {
  const jobs: SourceJob[] = [];
  let reported: number | null = null;
  let seen = 0;
  let limited = false;
  for (let page = 0; ; page++) {
    if (page === MAX_PAGES) {
      limited = true;
      break;
    }
    const data = feed.parse(
      await fetch(
        `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=${PAGE}&offset=${page * PAGE}&status=PUBLIC`,
      ),
    );
    if (page === 0) reported = data.totalFound ?? null;
    seen += data.content.length;
    for (const j of data.content) {
      const url = `https://jobs.smartrecruiters.com/${encodeURIComponent(slug)}/${encodeURIComponent(j.id)}`;
      jobs.push({
        title: j.name,
        company,
        location: [
          j.location.city,
          j.location.region,
          j.location.country,
          j.location.remote ? "Remote" : null,
        ]
          .filter(Boolean)
          .join(", "),
        url,
        attributionUrl: url,
        externalId: String(j.id),
        requisitionId: requisition(j.refNumber),
        description: "",
        postedAt: postedAt(j.releasedDate),
      });
    }
    if (data.content.length < PAGE) break;
  }
  return boardResult(jobs, reported, seen, limited);
}
