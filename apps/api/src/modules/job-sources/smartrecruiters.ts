import { z } from "zod/v4";
import { type FetchJson, postedAt, type SourceJob } from "./types";

const feed = z.object({
  content: z.array(
    z.object({
      id: z.union([z.string(), z.number()]),
      name: z.string(),
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
): Promise<SourceJob[]> {
  const jobs: SourceJob[] = [];
  for (let page = 0; page < 50; page++) {
    const data = feed.parse(
      await fetch(
        `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=100&offset=${page * 100}&status=PUBLIC`,
      ),
    );
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
        description: "",
        postedAt: postedAt(j.releasedDate),
      });
    }
    if (data.content.length < 100) break;
  }
  return jobs;
}
