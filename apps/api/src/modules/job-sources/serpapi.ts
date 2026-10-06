import type { discoverInputSchema } from "@openapply/contracts/job-sources";
import { z } from "zod/v4";
import { allowedApplyUrl } from "@/modules/job-board/blocked-sites";
import { type FetchJson, type SourceJob } from "./types";

const feed = z.object({
  jobs_results: z
    .array(
      z.object({
        title: z.string(),
        company_name: z.string(),
        location: z.string().default(""),
        description: z.string().default(""),
        share_link: z.url().optional(),
        apply_options: z.array(z.object({ link: z.url() })).default([]),
      }),
    )
    .default([]),
});
export async function serpapi(
  fetch: FetchJson,
  key: string,
  input: z.infer<typeof discoverInputSchema>,
): Promise<SourceJob[]> {
  const params = new URLSearchParams({
    engine: "google_jobs",
    q: input.query,
    location: input.location,
    api_key: key,
  });
  const data = feed.parse(await fetch(`https://serpapi.com/search.json?${params}`));
  return data.jobs_results.slice(0, input.limit).flatMap((j) => {
    const direct = j.apply_options.map((o) => allowedApplyUrl(o.link)).find(Boolean);
    const attributionUrl = j.share_link ?? j.apply_options[0]?.link;
    if (!attributionUrl) return [];
    // Google result/share URLs are attribution, never an employer apply destination.
    return [
      {
        title: j.title,
        company: j.company_name,
        location: j.location,
        url: direct ?? "",
        attributionUrl,
        description: j.description,
        postedAt: null,
      },
    ];
  });
}
