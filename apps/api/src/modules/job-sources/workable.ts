import { z } from "zod/v4";
import { type FetchJson, plainText, postedAt, type SourceJob } from "./types";

const feed = z.object({
  name: z.string().optional(),
  jobs: z.array(
    z.object({
      title: z.string(),
      shortlink: z.url().optional(),
      url: z.url().optional(),
      city: z.string().nullish(),
      country: z.string().nullish(),
      description: z.string().default(""),
      published_on: z.string().nullish(),
    }),
  ),
});
export async function workable(
  fetch: FetchJson,
  slug: string,
  company = slug,
): Promise<SourceJob[]> {
  const data = feed.parse(
    await fetch(
      `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}?details=true`,
    ),
  );
  return data.jobs.flatMap((j) => {
    const url = j.shortlink ?? j.url;
    if (!url || new URL(url).hostname !== "apply.workable.com") return [];
    return [
      {
        title: j.title,
        company: data.name ?? company,
        location: [j.city, j.country].filter(Boolean).join(", "),
        url,
        attributionUrl: url,
        description: plainText(j.description),
        postedAt: postedAt(j.published_on),
      },
    ];
  });
}
