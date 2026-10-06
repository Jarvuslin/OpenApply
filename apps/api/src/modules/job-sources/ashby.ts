import { z } from "zod/v4";
import { type FetchJson, postedAt, type SourceJob } from "./types";

const feed = z.object({
  jobs: z.array(
    z.object({
      title: z.string(),
      location: z.string(),
      jobUrl: z.url(),
      applyUrl: z.url().optional(),
      descriptionPlain: z.string().default(""),
      publishedAt: z.string().nullish(),
      isRemote: z.boolean().nullish(),
    }),
  ),
});
export async function ashby(fetch: FetchJson, slug: string, company = slug): Promise<SourceJob[]> {
  const data = feed.parse(
    await fetch(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`),
  );
  return data.jobs.map((j) => ({
    title: j.title,
    company,
    location: j.isRemote ? `${j.location}, Remote` : j.location,
    url: j.applyUrl ?? j.jobUrl,
    attributionUrl: j.jobUrl,
    description: j.descriptionPlain,
    postedAt: postedAt(j.publishedAt),
  }));
}
