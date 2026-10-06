import type {
  discoverInputSchema,
  discoveryConnectionSchema,
} from "@openapply/contracts/job-sources";
import { z } from "zod/v4";
import { unprocessable } from "@/common/errors";
import { type FetchJson, plainText, postedAt, type SourceJob } from "./types";

const row = z.object({
  title: z.string().optional(),
  jobTitle: z.string().optional(),
  companyName: z.string().optional(),
  company: z.union([z.string(), z.object({ name: z.string() })]).optional(),
  location: z
    .union([z.string(), z.object({ city: z.string().optional(), country: z.string().optional() })])
    .optional(),
  url: z.url().optional(),
  jobUrl: z.url().optional(),
  applyUrl: z.url().optional(),
  description: z.string().optional(),
  descriptionText: z.string().optional(),
  postedAt: z.string().nullish(),
});
export async function apify(
  fetch: FetchJson,
  key: string,
  config: z.infer<typeof discoveryConnectionSchema>,
  input: z.infer<typeof discoverInputSchema>,
): Promise<SourceJob[]> {
  const actor = input.board === "linkedin" ? config.linkedinActor : config.indeedActor;
  if (!input.board || !actor)
    throw unprocessable("Choose a board and configure its Apify actor first.");
  const data = await fetch(
    `https://api.apify.com/v2/acts/${encodeURIComponent(actor.id.replace("/", "~"))}/run-sync-get-dataset-items?timeout=25&memory=256&maxItems=${input.limit}`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        [actor.queryField]: input.query,
        [actor.locationField]: input.location,
        [actor.limitField]: input.limit,
      }),
    },
  );
  return z
    .array(row)
    .parse(data)
    .slice(0, input.limit)
    .flatMap((j) => {
      const title = j.title ?? j.jobTitle,
        attributionUrl = j.url ?? j.jobUrl;
      const company = typeof j.company === "string" ? j.company : j.company?.name;
      if (!title || !attributionUrl || !(j.companyName ?? company)) return [];
      const location =
        typeof j.location === "string"
          ? j.location
          : [j.location?.city, j.location?.country].filter(Boolean).join(", ");
      return [
        {
          title,
          company: j.companyName ?? company ?? "",
          location,
          url: j.applyUrl ?? attributionUrl,
          attributionUrl,
          description: plainText(j.descriptionText ?? j.description ?? ""),
          postedAt: postedAt(j.postedAt),
        },
      ];
    });
}
