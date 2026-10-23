import { z } from "zod/v4";
import { unprocessable } from "@/common/errors";
import {
  type BoardResult,
  boardResult,
  type FetchJson,
  plainText,
  postedAt,
  requisition,
  type SourceJob,
} from "./types";

// Jibe career sites sit on employer domains, "careers.amd.com"; http.ts lists each one.
const SITE_HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;
// The search API's largest page; the sites ask for 5 seconds between requests.
const PAGE = 100;
const MAX_PAGES = 30;

const text = z.string().nullish();
const page = z.object({
  totalCount: z.number().nullish(),
  jobs: z.array(
    z.object({
      data: z.object({
        slug: z.string().regex(/^[\w-]{1,40}$/),
        req_id: text,
        title: z.string(),
        description: text,
        responsibilities: text,
        qualifications: text,
        full_location: text,
        location_name: text,
        country_code: text,
        additional_locations: z.array(z.object({ country_code: text })).nullish(),
        posted_date: text,
      }),
    }),
  ),
});

export async function jibe(fetch: FetchJson, slug: string, company = slug): Promise<BoardResult> {
  if (!SITE_HOST.test(slug)) throw unprocessable("Invalid Jibe career site.");
  const origin = `https://${slug}`;
  const jobs = new Map<string, SourceJob>();
  let total: number | null = null;
  let seen = 0;
  let limited = false;
  for (let index = 1; ; index++) {
    if (index > MAX_PAGES) {
      limited = true;
      break;
    }
    const data = page.parse(await fetch(`${origin}/api/jobs?page=${index}&limit=${PAGE}`));
    total = data.totalCount ?? total;
    seen += data.jobs.length;
    for (const { data: job } of data.jobs) {
      const url = `${origin}/jobs/${job.slug}`;
      const countries = [
        job.country_code,
        ...(job.additional_locations ?? []).map((place) => place.country_code),
      ];
      jobs.set(job.slug, {
        title: plainText(job.title),
        // The posting names a legal entity, "Advanced Micro Devices, Inc"; the catalog's name wins.
        company,
        location: plainText(job.full_location ?? job.location_name ?? ""),
        countries: [...new Set(countries.filter((code): code is string => !!code))],
        url,
        attributionUrl: url,
        externalId: job.slug,
        requisitionId: requisition(job.req_id),
        description: [job.description, job.responsibilities, job.qualifications]
          .map((part) => plainText(part ?? ""))
          .filter(Boolean)
          .join("\n\n"),
        // "2026-10-21T00:44:00+0000".
        postedAt: postedAt(job.posted_date),
        workMode: /\bremote\b/i.test(job.location_name ?? "") ? "remote" : null,
      });
    }
    // Some sites report no total, so an empty page is the only sure end.
    if (data.jobs.length === 0 || (total !== null && seen >= total)) break;
  }
  return boardResult([...jobs.values()], total, seen, limited);
}
