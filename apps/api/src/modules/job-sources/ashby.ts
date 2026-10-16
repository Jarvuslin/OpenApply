import { z } from "zod/v4";
import { type FetchJson, postedAt, type SourceJob } from "./types";

const address = z.object({ addressCountry: z.string().nullish() });
const compensation = z.object({
  scrapeableCompensationSalarySummary: z.string().nullish(),
  summaryComponents: z
    .array(
      z.object({
        compensationType: z.string(),
        currencyCode: z.string().nullish(),
        interval: z.string().nullish(),
        minValue: z.number().nullish(),
        maxValue: z.number().nullish(),
      }),
    )
    .default([]),
});

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
      isListed: z.boolean().nullish(),
      workplaceType: z.string().nullish(),
      employmentType: z.string().nullish(),
      address: z.object({ postalAddress: address.nullish() }).nullish(),
      secondaryLocations: z
        .array(z.object({ location: z.string(), address: address.nullish() }))
        .default([]),
      compensation: compensation.nullish(),
    }),
  ),
});
export async function ashby(fetch: FetchJson, slug: string, company = slug): Promise<SourceJob[]> {
  const data = feed.parse(
    await fetch(
      `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`,
    ),
  );
  return data.jobs
    .filter((j) => j.isListed !== false)
    .map((j) => ({
      title: j.title,
      company,
      location: [
        ...new Set([
          j.location,
          ...j.secondaryLocations.map((entry) => entry.location),
          ...(j.isRemote && j.workplaceType !== "Hybrid" ? ["Remote"] : []),
        ]),
      ].join("; "),
      countries: [
        ...new Set(
          [
            j.address?.postalAddress?.addressCountry,
            ...j.secondaryLocations.map((entry) => entry.address?.addressCountry),
          ].filter((value): value is string => !!value),
        ),
      ],
      workMode: workMode(j.workplaceType, j.isRemote),
      type: j.employmentType,
      salary: salary(j.compensation),
      url: j.applyUrl ?? j.jobUrl,
      attributionUrl: j.jobUrl,
      description: j.descriptionPlain,
      postedAt: postedAt(j.publishedAt),
    }));
}

function workMode(
  value: string | null | undefined,
  remote: boolean | null | undefined,
): SourceJob["workMode"] {
  if (value === "Hybrid") return "hybrid";
  if (value === "OnSite") return "onsite";
  if (value === "Remote" || remote) return "remote";
  return null;
}

function salary(value: z.infer<typeof compensation> | null | undefined): string | null {
  const salaries =
    value?.summaryComponents.filter((entry) => entry.compensationType === "Salary") ?? [];
  const entry = salaries.length === 1 ? salaries[0] : undefined;
  const periods: Record<string, string> = {
    "1 YEAR": "year",
    "1 MONTH": "month",
    "1 HOUR": "hour",
  };
  const period = entry?.interval ? periods[entry.interval] : undefined;
  if (entry && entry.minValue != null && entry.maxValue != null && entry.currencyCode && period) {
    return `${entry.currencyCode} ${entry.minValue}-${entry.maxValue} /${period}`;
  }
  return value?.scrapeableCompensationSalarySummary ?? null;
}
