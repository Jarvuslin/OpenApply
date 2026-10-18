import { z } from "zod/v4";
import { withDetails } from "./details";
import { tooLarge } from "./http";
import {
  type BoardOptions,
  type BoardResult,
  boardResult,
  type FetchJson,
  plainText,
  postedAt,
  requisition,
  requisitionFrom,
  type SourceJob,
} from "./types";

const job = z.object({
  id: z.number(),
  title: z.string(),
  absolute_url: z.url(),
  // Some boards leave a job's location blank, as `{ "name": null }`.
  location: z.object({ name: z.string().nullish() }).nullish(),
  content: z.string().default(""),
  first_published: z.string().nullish(),
  requisition_id: z.string().nullish(),
});
const feed = z.object({
  jobs: z.array(job),
  meta: z.object({ total: z.number() }).nullish(),
});

function sourceJob(j: z.infer<typeof job>, company: string): SourceJob {
  const description = plainText(j.content);
  return {
    title: j.title,
    company,
    location: j.location?.name ?? "",
    url: j.absolute_url,
    attributionUrl: j.absolute_url,
    externalId: String(j.id),
    requisitionId: requisition(j.requisition_id) ?? requisitionFrom(description),
    description,
    // `updated_at` is the last edit; `first_published` is when the posting first went live.
    postedAt: postedAt(j.first_published),
  };
}

export async function greenhouse(
  fetch: FetchJson,
  slug: string,
  company = slug,
  options: BoardOptions = {},
): Promise<BoardResult> {
  const base = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`;
  let data: z.infer<typeof feed>;
  let withContent = true;
  try {
    data = feed.parse(await fetch(`${base}?content=true`));
  } catch (error) {
    // A few boards (SpaceX, Anduril) pass 20 MB with every description inline; their plain list
    // is ~2.5 MB, and descriptions then come one job at a time.
    if (!tooLarge(error)) throw error;
    withContent = false;
    data = feed.parse(await fetch(base));
  }
  const jobs = data.jobs.map((j) => sourceJob(j, company));
  if (!withContent)
    await withDetails(jobs, options, async (listed) => {
      const full = sourceJob(job.parse(await fetch(`${base}/${listed.externalId}`)), company);
      return {
        description: full.description,
        ...(full.requisitionId && { requisitionId: full.requisitionId }),
      };
    });
  return boardResult(jobs, data.meta?.total ?? null, data.jobs.length, false);
}
