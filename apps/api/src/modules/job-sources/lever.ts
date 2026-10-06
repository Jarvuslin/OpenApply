import { z } from "zod/v4";
import { type FetchJson, postedAt, type SourceJob } from "./types";

const feed = z.array(
  z.object({
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
export async function lever(fetch: FetchJson, slug: string, company = slug): Promise<SourceJob[]> {
  const data = feed.parse(
    await fetch(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`),
  );
  return data.map((j) => ({
    title: j.text,
    company,
    location: [
      ...new Set([j.categories.location, ...(j.categories.allLocations ?? [])].filter(Boolean)),
    ].join(", "),
    url: j.applyUrl ?? j.hostedUrl,
    attributionUrl: j.hostedUrl,
    description: j.descriptionPlain,
    postedAt: postedAt(j.createdAt),
  }));
}
