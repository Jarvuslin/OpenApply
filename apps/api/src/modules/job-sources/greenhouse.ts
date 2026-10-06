import { z } from "zod/v4";
import { type FetchJson, plainText, postedAt, type SourceJob } from "./types";

const feed = z.object({
  jobs: z.array(
    z.object({
      title: z.string(),
      absolute_url: z.url(),
      location: z.object({ name: z.string() }),
      content: z.string().default(""),
      updated_at: z.string().nullish(),
    }),
  ),
});
export async function greenhouse(
  fetch: FetchJson,
  slug: string,
  company = slug,
): Promise<SourceJob[]> {
  const data = feed.parse(
    await fetch(
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`,
    ),
  );
  return data.jobs.map((j) => ({
    title: j.title,
    company,
    location: j.location.name,
    url: j.absolute_url,
    attributionUrl: j.absolute_url,
    description: plainText(j.content),
    postedAt: postedAt(j.updated_at),
  }));
}
