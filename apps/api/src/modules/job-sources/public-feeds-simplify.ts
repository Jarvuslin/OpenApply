import { isIP } from "node:net";
import { jobLevelFromTitle } from "@openapply/contracts/job-listing";
import { z } from "zod/v4";
import { allowedApplyUrl } from "@/modules/job-board/blocked-sites";
import { canonicalizeUrl } from "@/modules/job-listing/dedupe";
import type { AtsProvider } from "./ats";
import { type FetchJson, plainText, type SourceJob } from "./types";

const NEW_GRAD = "SimplifyJobs/New-Grad-Positions";
const INTERNSHIPS = "SimplifyJobs/Summer2027-Internships";
const LISTINGS = "/dev/.github/scripts/listings.json";
// About 3,000 new-grad and 5,000 internship roles are active at once; the cap guards a runaway list.
const MAX_JOBS = 6000;
const listing = z.object({
  id: z.string().max(100).optional(),
  company_name: z.string().min(1).max(500),
  title: z.string().min(1).max(1000),
  url: z.string().max(4000),
  locations: z.array(z.string().max(500)).max(100),
  active: z.literal(true),
  is_visible: z.literal(true),
  date_posted: z.number().int().nonnegative(),
});
type Listing = z.infer<typeof listing>;

export function applyLink(value: string): string | null {
  const safe = allowedApplyUrl(plainText(value));
  if (!safe) return null;
  const url = new URL(safe);
  if (
    url.port ||
    isIP(url.hostname) ||
    /(^|\.)(localhost|local|internal)$/.test(url.hostname) ||
    /(^|\.)(simplify\.jobs|github\.com|raw\.githubusercontent\.com|bit\.ly|t\.co|lnkd\.in)$/.test(
      url.hostname,
    )
  )
    return null;
  return safe;
}

export function identity(value: string): string {
  const url = new URL(value);
  // These form variants identify the same posting URL used by the direct ATS adapters.
  if (url.hostname === "jobs.ashbyhq.com") {
    url.pathname = url.pathname.replace(/\/application\/?$/, "");
    url.searchParams.delete("embed");
  }
  if (["jobs.lever.co", "jobs.eu.lever.co"].includes(url.hostname))
    url.pathname = url.pathname.replace(/\/apply\/?$/, "");
  return canonicalizeUrl(url.href);
}

/** Active, visible rows of one Simplify list; malformed rows are skipped, a malformed list throws. */
async function activeListings(fetch: FetchJson, repository: string): Promise<Listing[]> {
  const rows = z
    .array(z.unknown())
    .max(50_000)
    .parse(await fetch(`https://raw.githubusercontent.com/${repository}${LISTINGS}`));
  return rows.flatMap((row) => {
    const parsed = listing.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

export const simplifyNewGrad = (fetch: FetchJson) => simplifyList(fetch, NEW_GRAD, "entry");
export const simplifyInternships = (fetch: FetchJson) => simplifyList(fetch, INTERNSHIPS, "intern");

/** Every active role with a direct employer link in one Simplify list, newest additions first. */
async function simplifyList(
  fetch: FetchJson,
  repository: string,
  fallbackLevel: "entry" | "intern",
): Promise<SourceJob[]> {
  const candidates: { job: SourceJob; addedAt: number }[] = [];
  for (const item of await activeListings(fetch, repository)) {
    const url = applyLink(item.url);
    if (!url) continue;
    const title = plainText(item.title);
    const company = plainText(item.company_name);
    if (!title || !company) continue;
    const level = jobLevelFromTitle(title);
    candidates.push({
      addedAt: item.date_posted,
      job: {
        title,
        company,
        location: [...new Set(item.locations.map(plainText).filter(Boolean))].join("; "),
        url,
        identityUrl: identity(url),
        attributionUrl: `https://github.com/${repository}`,
        externalId: item.id,
        description: "",
        // When Simplify listed the role, usually within a day of the employer; its "Age" column.
        postedAt: new Date(item.date_posted * 1000),
        level: level === "unknown" ? fallbackLevel : level,
      },
    });
  }
  candidates.sort((a, b) => b.addedAt - a.addedAt);
  const jobs = new Map<string, SourceJob>();
  for (const { job } of candidates) {
    const key = job.identityUrl ?? job.url;
    if (!jobs.has(key)) jobs.set(key, job);
    if (jobs.size === MAX_JOBS) break;
  }
  return [...jobs.values()];
}

export interface FoundBoard {
  provider: AtsProvider;
  slug: string;
  company: string;
}

const BOARD_SLUG = /^[a-zA-Z0-9_-][a-zA-Z0-9 _-]{0,79}$/;

/** The employer board an apply link belongs to, when it is one the ATS adapters can read. */
export function boardOf(address: string): Omit<FoundBoard, "company"> | null {
  const url = new URL(address);
  const [first, second] = url.pathname.split("/").filter(Boolean);
  let found: Omit<FoundBoard, "company"> | null = null;
  if (["boards.greenhouse.io", "job-boards.greenhouse.io"].includes(url.hostname)) {
    const slug = first === "embed" ? url.searchParams.get("for") : first;
    if (slug && (first === "embed" || second === "jobs")) found = { provider: "greenhouse", slug };
  }
  if (url.hostname === "jobs.ashbyhq.com" && first) found = { provider: "ashby", slug: first };
  if (url.hostname === "jobs.lever.co" && first) found = { provider: "lever", slug: first };
  if (url.hostname === "apply.workable.com" && first && first !== "j")
    found = { provider: "workable", slug: first };
  if (["jobs.smartrecruiters.com", "careers.smartrecruiters.com"].includes(url.hostname) && first)
    found = { provider: "smartrecruiters", slug: first };
  // "{tenant}.wd5.myworkdayjobs.com/en-US/{site}/job/..." is the Workday board "tenant.wd5.site".
  const workday = /^([a-z0-9-]{1,40})\.(wd\d{1,3})\.myworkdayjobs\.com$/.exec(url.hostname);
  if (workday) {
    const parts = url.pathname.split("/").filter(Boolean);
    const site = /^[a-z]{2}(?:-[a-z]{2})?$/i.test(parts[0] ?? "") ? parts[1] : parts[0];
    if (site && /^[A-Za-z0-9_-]{1,60}$/.test(site))
      return { provider: "workday", slug: `${workday[1]}.${workday[2]}.${site}` };
  }
  return found && BOARD_SLUG.test(found.slug) ? found : null;
}

/** Employer boards behind the active roles in Simplify's new-grad and internship lists. */
export async function simplifyBoards(fetch: FetchJson): Promise<FoundBoard[]> {
  const boards = new Map<string, FoundBoard & { addedAt: number }>();
  for (const repository of [NEW_GRAD, INTERNSHIPS]) {
    for (const item of await activeListings(fetch, repository)) {
      const url = applyLink(item.url);
      const board = url ? boardOf(url) : null;
      const company = plainText(item.company_name);
      if (!board || !company) continue;
      const key = `${board.provider}/${board.slug.toLowerCase()}`;
      const known = boards.get(key);
      // The newest row names the company, since boards outlive renames.
      if (!known || item.date_posted > known.addedAt)
        boards.set(key, { ...board, company, addedAt: item.date_posted });
    }
  }
  return [...boards.values()].map(({ provider, slug, company }) => ({ provider, slug, company }));
}
