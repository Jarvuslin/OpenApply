import { allowedApplyUrl } from "@/modules/job-board/blocked-sites";
/**
 * Turn a campaign `Job` row into a publishable public listing - or reject it. Pure and Prisma-free:
 * this is both the privacy boundary (only digest fields cross it) and the quality gate, so it is
 * the part that unit-tests with no database.
 */

import {
  type JOB_LEVELS,
  JOB_WORK_MODES,
  jobLevelFromTitle,
} from "@openapply/contracts/job-listing";
import { z } from "zod/v4";
import { sha256 } from "@/common/crypto/hash";
import { MAX_YEARS_EXPERIENCE } from "@/modules/scoring/scoring.schema";
import { validatePublicLogoUrl } from "./company-logo-http";
import { canonicalizeUrl, dedupeKey, listingSlug, normalizeListingLocation } from "./dedupe";
import { listingCountryCodes } from "./listing-countries";
import { matchKey } from "./listing-match";
import { listingEmploymentKind, listingWorkMode, normalizeListingSalary } from "./listing-metadata";
import { postingIdentity } from "./posting-identity";
import { sourceRank } from "./source-rank";

const MAX_EXCERPT = 600;

/** Bullets are scraped text landing in a public payload, so both dimensions are capped. */
const MAX_BULLETS = 12;
const MAX_BULLET_LENGTH = 300;

/**
 * Looser than scoring's `jobDigestSchema`, which strips the posting-shaped keys
 * (location/salary/remote) this index wants. `Job.digest` is raw JSON, so they are usually present.
 */
const digestSchema = z.object({
  skills: z.array(z.string()).optional(),
  descriptionExcerpt: z.string().optional(),
  location: z.string().optional(),
  salary: z.string().optional(),
  employmentType: z.string().optional(),
  remote: z.boolean().optional(),
  workMode: z.enum(JOB_WORK_MODES).optional(),
  requirements: z.array(z.string()).optional(),
  responsibilities: z.array(z.string()).optional(),
  yearsExperience: z.number().optional(),
});

/** The subset of a `Job` a listing may read. Anything user-identifying is absent by design. */
export interface ListingSourceJob {
  /** Set only by a validated public ATS feed adapter, never from a user request. */
  publicFeed?: boolean;
  applyUrl?: string | null;
  attributionUrl?: string;
  resolutionConfidence?: number;
  postedAt?: Date | null;
  workMode?: (typeof JOB_WORK_MODES)[number] | null;
  companyLogoUrl?: string | null;
  companyLogoPageUrl?: string;
  countries?: string[];
  level?: (typeof JOB_LEVELS)[number];
  /** The job's company, already resolved from its board (see CompanyResolver). */
  companyId?: string | null;
  /** "provider/slug" of the board the job was read from; else traced from an ATS link. */
  boardKey?: string | null;
  externalId?: string | null;
  requisitionId?: string | null;
  title: string;
  company: string;
  url: string;
  status?: string;
  location?: string | null;
  salary?: string | null;
  type?: string | null;
  board?: string | null;
  description?: string | null;
  digest?: string | null;
}

export interface ListingDraft {
  countries: string[];
  applyUrl: string | null;
  attributionUrl: string;
  resolutionConfidence: number;
  postedAt: Date | null;
  level: (typeof JOB_LEVELS)[number];
  dedupeKey: string;
  matchKey: string;
  companyId: string | null;
  boardKey: string | null;
  externalId: string | null;
  requisitionId: string | null;
  rank: number;
  slug: string;
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  workMode: ReturnType<typeof listingWorkMode>;
  employmentKind: ReturnType<typeof listingEmploymentKind>;
  companyLogoUrl: string | null;
  salary: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: ReturnType<typeof normalizeListingSalary>["salaryPeriod"];
  employmentType: string | null;
  skills: string[];
  descriptionExcerpt: string | null;
  requirements: string[];
  responsibilities: string[];
  yearsExperience: number | null;
  board: string | null;
  url: string;
}

function parseDigest(raw: string | null | undefined): z.infer<typeof digestSchema> {
  if (!raw) {
    return {};
  }
  try {
    const parsed = digestSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    // A malformed digest is a thin job, not an error - the next PATCH usually fixes it.
    return {};
  }
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max).trimEnd()}…` : value;
}

function excerpt(value: string | null): string | null {
  return value ? truncate(value, MAX_EXCERPT) : null;
}

function bullets(values: string[] | undefined): string[] {
  return (values ?? [])
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, MAX_BULLETS)
    .map((v) => truncate(v, MAX_BULLET_LENGTH));
}

function yearsExperience(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const years = Math.trunc(value);
  return years >= 0 && years <= MAX_YEARS_EXPERIENCE ? years : null;
}

/**
 * Build the draft, or null when the job is too thin to publish - the one gate every publish path
 * routes through, so callers never pre-filter. A stub the agent never opened has no digest; the
 * PATCH that adds one re-runs this.
 */
export function buildListingDraft(job: ListingSourceJob): ListingDraft | null {
  // A queued row is a bare pasted URL with a placeholder title; nothing to index until it's visited.
  if (job.status === "queued") {
    return null;
  }
  const title = clean(job.title);
  const company = clean(job.company);
  const url = clean(job.url);
  if (!title || !company || !url) {
    return null;
  }

  const digest = parseDigest(job.digest);
  // A posting with no named skills has nothing to filter or match on, so it never gets published.
  const skills = (digest.skills ?? []).map((skill) => skill.trim()).filter(Boolean);
  if (skills.length === 0 && !job.publicFeed) {
    return null;
  }

  const location = clean(job.location) ?? clean(digest.location);
  const key = dedupeKey({ title, company, location });
  const salary = clean(job.salary) ?? clean(digest.salary);
  const employmentType = clean(job.type) ?? clean(digest.employmentType);
  const remote = digest.remote === true || normalizeListingLocation(location) === "remote";
  const titleLevel = jobLevelFromTitle(title);
  const canonical = canonicalizeUrl(url);
  const traced = job.boardKey ? null : postingIdentity(canonical);
  const board = clean(job.board)?.toLowerCase() ?? null;

  return {
    applyUrl: job.applyUrl === undefined ? allowedApplyUrl(url) : allowedApplyUrl(job.applyUrl),
    attributionUrl: job.attributionUrl ?? url,
    resolutionConfidence: job.resolutionConfidence ?? (allowedApplyUrl(url) ? 1 : 0),
    postedAt: job.postedAt ?? null,
    level:
      titleLevel === "unknown" && job.publicFeed === true ? (job.level ?? titleLevel) : titleLevel,
    dedupeKey: key,
    matchKey: matchKey(title, location),
    companyId: job.companyId ?? null,
    boardKey: job.boardKey?.toLowerCase() ?? traced?.boardKey ?? null,
    externalId: job.boardKey ? (job.externalId ?? null) : (traced?.externalId ?? null),
    requisitionId: clean(job.requisitionId),
    rank: sourceRank(board),
    // Keyed by the posting's own URL: two openings can share a title, company and city.
    slug: listingSlug({ title, company, location }, sha256(canonical)),
    title,
    company,
    location,
    countries: listingCountryCodes(job.countries, location),
    remote,
    workMode: listingWorkMode(location, remote, job.workMode ?? digest.workMode),
    companyLogoUrl: job.companyLogoUrl ? validatePublicLogoUrl(job.companyLogoUrl) : null,
    salary,
    ...normalizeListingSalary(salary),
    employmentType,
    employmentKind: listingEmploymentKind(employmentType),
    skills,
    descriptionExcerpt: excerpt(clean(digest.descriptionExcerpt) ?? clean(job.description)),
    requirements: bullets(digest.requirements),
    responsibilities: bullets(digest.responsibilities),
    yearsExperience: yearsExperience(digest.yearsExperience),
    // Lowercased so the `?board=` filter is an indexed equality hit, not an ILIKE scan.
    board,
    url: canonical,
  };
}
