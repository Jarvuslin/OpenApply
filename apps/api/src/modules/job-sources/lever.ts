import { z } from "zod/v4";
import {
  type BoardResult,
  boardResult,
  type FetchJson,
  postedAt,
  requisitionFrom,
  type SourceJob,
} from "./types";

// Lever pages with skip/limit; one unpaged board (CGS Federal) passed 36 MB.
const PAGE = 100;
const MAX_PAGES = 50;

const feed = z.array(
  z.object({
    id: z.string(),
    text: z.string(),
    hostedUrl: z.url(),
    applyUrl: z.url().optional(),
    categories: z
      .object({ location: z.string().optional(), allLocations: z.array(z.string()).optional() })
      .default({}),
    descriptionPlain: z.string().default(""),
    createdAt: z.number().nullish(),
  }),
);

export async function lever(fetch: FetchJson, slug: string, company = slug): Promise<BoardResult> {
  const jobs: SourceJob[] = [];
  let limited = false;
  for (let index = 0; ; index++) {
    if (index === MAX_PAGES) {
      limited = true;
      break;
    }
    const data = feed.parse(
      await fetch(
        `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json&skip=${index * PAGE}&limit=${PAGE}`,
      ),
    );
    for (const j of data)
      jobs.push({
        title: j.text,
        company,
        location: [
          ...new Set([j.categories.location, ...(j.categories.allLocations ?? [])].filter(Boolean)),
        ].join(", "),
        url: j.applyUrl ?? j.hostedUrl,
        attributionUrl: j.hostedUrl,
        externalId: j.id,
        requisitionId: requisitionFrom(j.descriptionPlain),
        description: j.descriptionPlain,
        postedAt: postedAt(j.createdAt),
      });
    if (data.length < PAGE) break;
  }
  // Lever reports no total, so only the page cap can show a board was cut short.
  return boardResult(jobs, null, jobs.length, limited);
}
