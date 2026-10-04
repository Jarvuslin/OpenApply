import { z } from "zod/v4";
import type { ListingSourceJob } from "@/modules/job-listing/listing-draft";
import { listedExperience } from "./experience";

const ashbyFeed = z.object({
  jobs: z.array(
    z.object({
      title: z.string(),
      location: z.string(),
      jobUrl: z.url(),
      applyUrl: z.url().optional(),
      descriptionPlain: z.string().default(""),
      isRemote: z.boolean().nullish(),
      employmentType: z.string().optional(),
    }),
  ),
});
const greenhouseFeed = z.object({
  jobs: z.array(
    z.object({
      title: z.string(),
      absolute_url: z.url(),
      location: z.object({ name: z.string() }),
      content: z.string().default(""),
    }),
  ),
});

export function normalizeFeed(
  provider: "ashby" | "greenhouse",
  board: string,
  data: unknown,
): ListingSourceJob[] {
  if (provider === "ashby")
    return ashbyFeed.parse(data).jobs.map((job) => ({
      title: job.title,
      company: board,
      url: job.applyUrl ?? job.jobUrl,
      location: job.location,
      board: "ashby",
      description: job.descriptionPlain,
      digest: JSON.stringify({
        remote: job.isRemote ?? false,
        employmentType: job.employmentType,
        yearsExperience: listedExperience(job.descriptionPlain),
      }),
    }));
  return greenhouseFeed.parse(data).jobs.map((job) => ({
    title: job.title,
    company: board,
    url: job.absolute_url,
    location: job.location.name,
    board: "greenhouse",
    description: job.content
      .replace(/<[^>]*>/g, " ")
      .replace(/&[^;]+;/g, " ")
      .replace(/\s+/g, " "),
    digest: JSON.stringify({
      remote: /remote/i.test(job.location.name),
      yearsExperience: listedExperience(job.content.replace(/<[^>]*>/g, " ")),
    }),
  }));
}
