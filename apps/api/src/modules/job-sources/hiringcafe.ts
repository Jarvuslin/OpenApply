import { z } from "zod/v4";
import { type FetchJson, plainText, postedAt, type SourceJob } from "./types";

const inputSchema = z.object({
  query: z.string().max(300).optional(),
  location: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(25).default(25),
  workModes: z
    .array(z.enum(["remote", "hybrid", "onsite"]))
    .max(3)
    .optional(),
  postedWithinDays: z.number().int().min(1).max(365).optional(),
});
const compensation = z.object({
  currency: z.string(),
  frequency: z.string(),
  minimum: z.number().nullable(),
  maximum: z.number().nullable(),
});
const results = z.object({
  jobs: z.array(
    z.object({
      title: z.string(),
      company: z.string(),
      location: z.string(),
      workplaceType: z.string(),
      employmentTypes: z.array(z.string()),
      compensation: compensation.nullable(),
      datePosted: z.string().nullable(),
      requirementsSummary: z.string().nullable(),
      responsibilities: z.array(z.string()),
      technologies: z.array(z.string()),
      applyUrl: z.url(),
    }),
  ),
  total_matches: z.number().int().nullable(),
});

function salary(value: z.infer<typeof compensation> | null): string | null {
  if (!value || (value.minimum == null && value.maximum == null)) return null;
  const periods: Record<string, string> = {
    Yearly: "year",
    Monthly: "month",
    Weekly: "week",
    Daily: "day",
    Hourly: "hour",
  };
  const period = periods[value.frequency];
  if (!period || !/^[A-Z]{3}$/.test(value.currency)) return null;
  if (value.minimum == null) return `${value.currency} up to ${value.maximum} /${period}`;
  if (value.maximum == null) return `${value.currency} from ${value.minimum} /${period}`;
  return `${value.currency} ${value.minimum}-${value.maximum} /${period}`;
}

// HiringCafe permits conversational search, not bulk redistribution into the shared job catalog.
export async function hiringCafeSearch(
  fetch: FetchJson,
  input: z.input<typeof inputSchema>,
): Promise<{ jobs: SourceJob[]; totalMatches: number | null; hasMore: false }> {
  const query = inputSchema.parse(input);
  const modes = { remote: "Remote", hybrid: "Hybrid", onsite: "Onsite" } as const;
  const response = z
    .object({
      error: z.unknown().optional(),
      result: z
        .object({ isError: z.boolean().optional(), structuredContent: z.unknown().optional() })
        .optional(),
    })
    .parse(
      await fetch("https://hiringcafe.com/api/chatgpt/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "search_hiringcafe_jobs",
            arguments: {
              search: query.query,
              location: query.location,
              limit: query.limit,
              workplace_types: query.workModes?.map((mode) => modes[mode]),
              posted_within_days: query.postedWithinDays,
            },
          },
        }),
      }),
    );
  if (response.error || response.result?.isError)
    throw new Error("HiringCafe could not complete this search.");
  const data = results.parse(response.result?.structuredContent);
  const workModes: Record<string, SourceJob["workMode"]> = {
    Remote: "remote",
    Hybrid: "hybrid",
    Onsite: "onsite",
  };
  const jobs: SourceJob[] = [];
  const seen = new Set<string>();
  for (const job of data.jobs.slice(0, query.limit)) {
    const url = new URL(job.applyUrl);
    if (url.protocol !== "https:" || url.hostname !== "hiringcafe.com" || seen.has(url.href))
      continue;
    seen.add(url.href);
    jobs.push({
      title: plainText(job.title),
      company: plainText(job.company),
      location: plainText(job.location),
      url: url.href,
      attributionUrl: url.href,
      description: [job.requirementsSummary, ...job.responsibilities, job.technologies.join(", ")]
        .filter(Boolean)
        .map((value) => plainText(value!))
        .join("\n\n"),
      postedAt: postedAt(job.datePosted),
      workMode: workModes[job.workplaceType] ?? null,
      type: job.employmentTypes.join(", ") || null,
      salary: salary(job.compensation),
    });
  }
  return { jobs, totalMatches: data.total_matches, hasMore: false };
}
