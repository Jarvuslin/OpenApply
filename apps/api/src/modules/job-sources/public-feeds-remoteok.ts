import { z } from "zod/v4";
import { type FetchJson, plainText, postedAt, type SourceJob } from "./types";

const job = z.object({
  position: z.string().min(1),
  company: z.string().min(1),
  url: z.url(),
  description: z.string().default(""),
  location: z.string().default(""),
  date: z.string().nullish(),
  epoch: z.number().nullish(),
  company_logo: z.string().nullish(),
});

export async function remoteOk(fetch: FetchJson): Promise<SourceJob[]> {
  const data = z.array(z.unknown()).parse(await fetch("https://remoteok.com/api"));
  const jobs: SourceJob[] = [];
  const seen = new Set<string>();
  for (const row of data.slice(0, 1001)) {
    const result = job.safeParse(row);
    if (!result.success) continue;
    const item = result.data;
    const url = new URL(item.url);
    if (url.protocol !== "https:" || url.hostname !== "remoteok.com" || seen.has(url.href))
      continue;
    seen.add(url.href);
    jobs.push({
      title: plainText(item.position),
      company: plainText(item.company),
      companyLogoUrl: item.company_logo || null,
      location: plainText(item.location) || "Remote — location not specified",
      url: url.href,
      attributionUrl: url.href,
      description: plainText(item.description),
      postedAt: postedAt(item.date) ?? postedAt(item.epoch == null ? null : item.epoch * 1000),
      workMode: "remote",
    });
  }
  return jobs;
}
