import { z } from "zod/v4";
import {
  type BoardResult,
  boardResult,
  type FetchJson,
  plainText,
  postedAt,
  requisition,
  requisitionFrom,
  type SourceJob,
} from "./types";

const feed = z.object({
  name: z.string().optional(),
  jobs: z.array(
    z.object({
      title: z.string(),
      shortcode: z.string(),
      code: z.string().nullish(),
      shortlink: z.url().optional(),
      url: z.url().optional(),
      city: z.string().nullish(),
      country: z.string().nullish(),
      description: z.string().default(""),
      requirements: z.string().default(""),
      benefits: z.string().default(""),
      published_on: z.string().nullish(),
    }),
  ),
});
export async function workable(
  fetch: FetchJson,
  slug: string,
  company = slug,
): Promise<BoardResult> {
  const data = feed.parse(
    await fetch(
      `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}?details=true`,
    ),
  );
  const jobs = data.jobs.flatMap((j): SourceJob[] => {
    const url = j.shortlink ?? j.url;
    if (!url || new URL(url).hostname !== "apply.workable.com") return [];
    const description = [j.description, j.requirements, j.benefits]
      .map(plainText)
      .filter(Boolean)
      .join("\n\n");
    return [
      {
        title: j.title,
        company: data.name ?? company,
        location: [j.city, j.country].filter(Boolean).join(", "),
        url,
        attributionUrl: url,
        companyLogoPageUrl: `https://apply.workable.com/${encodeURIComponent(slug)}`,
        externalId: j.shortcode,
        // `code` is the employer's own job code when they set one.
        requisitionId: requisition(j.code) ?? requisitionFrom(description),
        description,
        postedAt: postedAt(j.published_on),
      },
    ];
  });
  // The widget returns every published job in one response.
  return boardResult(jobs, null, jobs.length, false);
}
