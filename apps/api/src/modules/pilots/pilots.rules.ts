import type { PilotRules } from "@openapply/contracts/pilots";
import type { Prisma } from "@/generated/prisma/client";
import { listingFilters } from "@/modules/job-listing/listing-filters";
import { listingVisibility } from "@/modules/job-listing/listing-visibility";
import { placeWhere } from "@/modules/locations/locations.service";

const MINUTE_MS = 60_000;

/** Posted when the source says so, else when the index first saw the listing. */
function postedWithin(minutes: number, now: Date): Prisma.JobListingWhereInput {
  const since = new Date(now.getTime() - minutes * MINUTE_MS);
  return { OR: [{ postedAt: { gte: since } }, { postedAt: null, firstSeenAt: { gte: since } }] };
}

/** Picked places; remote work is a work mode, never a location. */
function locationFilter(locations: string[]): Prisma.JobListingWhereInput | null {
  return locations.length ? { OR: locations.map(placeWhere) } : null;
}

function mentions(term: string): Prisma.JobListingWhereInput[] {
  return [
    { title: { contains: term, mode: "insensitive" } },
    { descriptionExcerpt: { contains: term, mode: "insensitive" } },
  ];
}

/** Published listings this user may see, posted in the pilot's widest window. */
export function windowWhere(
  rules: PilotRules,
  userId: string,
  now: Date,
): Prisma.JobListingWhereInput {
  const widest = rules.postedWithin.length ? Math.max(...rules.postedWithin) : null;
  return {
    status: "published",
    AND: [listingVisibility(userId), ...(widest ? [postedWithin(widest, now)] : [])],
  };
}

/**
 * The pilot's rules over the shared index. Company type has no listing data yet, so it does not
 * narrow the search; the agent's fit score still applies.
 */
export function rulesWhere(
  rules: PilotRules,
  userId: string,
  now: Date,
): Prisma.JobListingWhereInput {
  const base = listingFilters(
    {
      page: 1,
      limit: 1,
      titles: rules.roles.length ? rules.roles : undefined,
      levels: rules.levels.length ? rules.levels : undefined,
      includeUnknownLevel: rules.includeUnknown,
      noExperience: rules.noExperience,
      minYears: rules.minYears ?? undefined,
      maxYears: rules.maxYears ?? undefined,
      includeUnknownYears: rules.includeUnknown,
      companies: rules.companies.length ? rules.companies : undefined,
      excludeCompanies: rules.skipCompanies.length ? rules.skipCompanies : undefined,
      workModes: rules.workModes.length ? rules.workModes : undefined,
    },
    [],
  );
  const and: Prisma.JobListingWhereInput[] = [windowWhere(rules, userId, now)];
  const location = locationFilter(rules.locations);
  if (location) and.push(location);
  if (rules.keywords.length) and.push({ OR: rules.keywords.flatMap(mentions) });
  if (rules.excludeKeywords.length) and.push({ NOT: rules.excludeKeywords.flatMap(mentions) });
  // A job applied to through any path never comes back.
  and.push({ applications: { none: { userId } } });
  return { ...base, AND: [...((base.AND as Prisma.JobListingWhereInput[]) ?? []), ...and] };
}

/** The narrowest selected window the posting still fits, or null when any time is allowed. */
export function windowFor(posted: Date, windows: number[], now: Date): number | null {
  const age = (now.getTime() - posted.getTime()) / MINUTE_MS;
  const fits = [...windows].sort((a, b) => a - b).find((minutes) => age <= minutes);
  return fits ?? (windows.length ? Math.max(...windows) : null);
}

export type SettledStatus = "review" | "below_fit" | "unscored";

/** Where a scored job lands once its run finishes. */
export function settledStatus(score: number | null, minScore: number): SettledStatus {
  if (score === null) return "unscored";
  return score >= minScore ? "review" : "below_fit";
}
