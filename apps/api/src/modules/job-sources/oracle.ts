import { z } from "zod/v4";
import { unprocessable } from "@/common/errors";
import { withDetails } from "./details";
import {
  type BoardOptions,
  type BoardResult,
  boardResult,
  type FetchJson,
  plainText,
  postedAt,
  type SourceJob,
} from "./types";

// Oracle Recruiting Cloud: "eeho.fa.us2.oraclecloud.com/CX_45001", the tenant host and career site.
const SITE_SLUG = /^([a-z0-9-]+(?:\.[a-z0-9-]+)*\.oraclecloud\.com)\/([A-Za-z0-9_]{1,40})$/;
// The finder returns at most 200 requisitions a request.
const PAGE = 200;
const MAX_PAGES = 25;
// Many sites leave the list's short description empty; those jobs are read from their detail.
const THIN = 200;

const text = z.string().nullish();
const page = z.object({
  items: z.array(
    z.object({
      TotalJobsCount: z.number().default(0),
      requisitionList: z
        .array(
          z.object({
            Id: z.union([z.string(), z.number()]),
            Title: z.string(),
            PostedDate: text,
            PrimaryLocation: text,
            PrimaryLocationCountry: text,
            WorkplaceType: text,
            ShortDescriptionStr: text,
            ExternalQualificationsStr: text,
            ExternalResponsibilitiesStr: text,
            secondaryLocations: z.array(z.object({ Name: text, CountryCode: text })).nullish(),
          }),
        )
        .default([]),
    }),
  ),
});
const detail = z.object({
  items: z.array(
    z.object({
      ExternalPostedStartDate: text,
      ExternalDescriptionStr: text,
      ExternalResponsibilitiesStr: text,
      ExternalQualificationsStr: text,
    }),
  ),
});

export function oracleSite(slug: string) {
  const match = SITE_SLUG.exec(slug);
  return match ? { host: match[1] as string, site: match[2] as string } : null;
}

export async function oracle(
  fetch: FetchJson,
  slug: string,
  company = slug,
  options: BoardOptions = {},
): Promise<BoardResult> {
  const board = oracleSite(slug);
  if (!board) throw unprocessable("Invalid Oracle Recruiting site.");
  const api = `https://${board.host}/hcmRestApi/resources/latest`;
  const jobs: SourceJob[] = [];
  let total = 0;
  let seen = 0;
  let limited = false;
  for (let index = 0; ; index++) {
    if (index === MAX_PAGES) {
      limited = true;
      break;
    }
    const finder = `findReqs;siteNumber=${board.site},limit=${PAGE},offset=${index * PAGE},sortBy=POSTING_DATES_DESC`;
    const data = page.parse(
      await fetch(
        `${api}/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=${finder}`,
      ),
    ).items[0];
    if (!data) break;
    if (index === 0) total = data.TotalJobsCount;
    seen += data.requisitionList.length;
    for (const job of data.requisitionList) {
      const url = `https://${board.host}/hcmUI/CandidateExperience/en/sites/${board.site}/job/${job.Id}`;
      const secondary = job.secondaryLocations ?? [];
      const places = [job.PrimaryLocation, ...secondary.map((place) => place.Name)].filter(
        (place): place is string => !!place,
      );
      const countries = [
        job.PrimaryLocationCountry,
        ...secondary.map((place) => place.CountryCode),
      ];
      jobs.push({
        title: plainText(job.Title),
        company,
        location: [...new Set(places)].join("; "),
        countries: [...new Set(countries.filter((code): code is string => !!code))],
        url,
        attributionUrl: url,
        externalId: String(job.Id),
        // The number a candidate sees on the posting, so other sources quote this one.
        requisitionId: String(job.Id),
        description: describe(
          job.ShortDescriptionStr,
          job.ExternalResponsibilitiesStr,
          job.ExternalQualificationsStr,
        ),
        // "2026-10-17": the day the requisition was posted to this site.
        postedAt: postedAt(job.PostedDate ? `${job.PostedDate}T00:00:00Z` : null),
        workMode: workMode(job.WorkplaceType),
      });
    }
    // A full page can come back a row short, so only an empty page or the total ends the board.
    if (data.requisitionList.length === 0 || (index + 1) * PAGE >= total) break;
  }
  const thin = jobs.filter((job) => job.description.length < THIN);
  await withDetails(thin, options, async (listed) => {
    const finder = `ById;Id=%22${listed.externalId}%22,siteNumber=${board.site}`;
    const info = detail.parse(
      await fetch(
        `${api}/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=${finder}`,
      ),
    ).items[0];
    if (!info) return {};
    const posted = postedAt(info.ExternalPostedStartDate);
    return {
      description: describe(
        info.ExternalDescriptionStr,
        info.ExternalResponsibilitiesStr,
        info.ExternalQualificationsStr,
      ),
      ...(posted && { postedAt: posted }),
    };
  });
  return boardResult(jobs, total, seen, limited);
}

function describe(...parts: (string | null | undefined)[]): string {
  return [...new Set(parts.map((part) => plainText(part ?? "")).filter(Boolean))].join("\n\n");
}

function workMode(value: string | null | undefined): SourceJob["workMode"] {
  const mode = value?.toLowerCase() ?? "";
  if (mode.includes("hybrid")) return "hybrid";
  if (mode.includes("remote")) return "remote";
  if (mode.includes("site") || mode.includes("office")) return "onsite";
  return null;
}
