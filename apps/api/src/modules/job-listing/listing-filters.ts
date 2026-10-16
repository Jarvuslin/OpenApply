import type { AdminJobListingQuery } from "@openapply/contracts/job-listing";
import { unprocessable } from "@/common/errors";
import type { Prisma } from "@/generated/prisma/client";
import { placeWhere } from "@/modules/locations/locations.service";
import { sourceVisibility } from "./listing-visibility";

const DAY_MS = 86_400_000;

function dateRange(
  from?: string,
  to?: string,
  withinDays?: number,
  asOf = new Date(Date.now()),
): Prisma.DateTimeFilter | null {
  if (withinDays !== undefined && (from || to)) {
    throw unprocessable("Choose a date preset or a custom range, not both.");
  }
  if (from && to && from > to) throw unprocessable("Start date cannot be after end date.");
  if (withinDays !== undefined) return { gte: new Date(asOf.getTime() - withinDays * DAY_MS) };
  if (!from && !to) return null;
  return {
    ...(from && { gte: new Date(`${from}T00:00:00.000Z`) }),
    ...(to && { lt: new Date(new Date(`${to}T00:00:00.000Z`).getTime() + DAY_MS) }),
  };
}

// Few postings say "no experience required" outright, so internships and entry jobs that name
// no years count too.
const NO_EXPERIENCE: Prisma.JobListingWhereInput = {
  OR: [{ yearsExperience: 0 }, { level: "intern" }, { level: "entry", yearsExperience: null }],
};

/** Years a posting asks for within the range; postings that don't say are kept on request. */
function yearsWhere(
  min: number | undefined,
  max: number | undefined,
  includeUnknown = false,
): Prisma.JobListingWhereInput | null {
  if (min === undefined && max === undefined) return null;
  const range = {
    yearsExperience: {
      ...(min !== undefined && { gte: min }),
      ...(max !== undefined && { lte: max }),
    },
  };
  return includeUnknown ? { OR: [range, { yearsExperience: null }] } : range;
}

function titleVariants(title: string): string[] {
  const variants = new Set([title]);
  for (const [pattern, alternatives] of [
    [/\bfront[ -]?end\b/i, ["frontend", "front-end", "front end"]],
    [/\bback[ -]?end\b/i, ["backend", "back-end", "back end"]],
    [/\bfull[ -]?stack\b/i, ["fullstack", "full-stack", "full stack"]],
    [/\bsoftware engineer(?:ing)?\b/i, ["software engineer", "software engineering"]],
  ] as const) {
    if (pattern.test(title)) {
      for (const alternative of alternatives) variants.add(title.replace(pattern, alternative));
    }
  }
  return [...variants];
}

/** All constraints run before pagination; groups use OR within a facet and AND between facets. */
export function listingFilters(
  query: AdminJobListingQuery,
  skills: string[],
  userId?: string,
): Prisma.JobListingWhereInput {
  const {
    q,
    location,
    remote,
    board,
    status,
    level,
    maxYears,
    titles,
    locations,
    levels,
    workModes,
    employmentTypes,
    salaryMin,
    salaryMax,
    salaryCurrency,
    salaryPeriod,
    includeUnknownSalary,
    sort,
  } = query;
  const hasSalaryRange = salaryMin !== undefined || salaryMax !== undefined;
  if ((hasSalaryRange || sort === "salary_desc") && (!salaryCurrency || !salaryPeriod)) {
    throw unprocessable(
      "Choose a salary currency and pay period before filtering or sorting by pay.",
    );
  }
  if (salaryMin !== undefined && salaryMax !== undefined && salaryMin > salaryMax) {
    throw unprocessable("Minimum salary cannot exceed maximum salary.");
  }
  const and: Prisma.JobListingWhereInput[] = [];
  const asOf = query.indexedBefore ? new Date(query.indexedBefore) : new Date(Date.now());
  if (query.indexedBefore) and.push({ firstSeenAt: { lte: asOf } });
  if (q)
    and.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { company: { contains: q, mode: "insensitive" } },
      ],
    });
  if (titles?.length)
    and.push({
      OR: [...new Set(titles.flatMap(titleVariants))].map((title) => ({
        title: { contains: title, mode: "insensitive" },
      })),
    });
  if (locations?.length) and.push({ OR: locations.map(placeWhere) });
  const levelMatches: Prisma.JobListingWhereInput[] = [];
  if (levels?.length)
    levelMatches.push({
      level: {
        in: query.includeUnknownLevel ? [...new Set([...levels, "unknown" as const])] : levels,
      },
    });
  if (query.noExperience) levelMatches.push(NO_EXPERIENCE);
  const [onlyLevel] = levelMatches;
  if (levelMatches.length > 1) and.push({ OR: levelMatches });
  else if (onlyLevel) and.push(onlyLevel);
  const years = yearsWhere(query.minYears, maxYears, query.includeUnknownYears);
  if (years) and.push(years);
  if (query.countries?.length) and.push({ countries: { hasSome: query.countries } });
  if (query.companies?.length)
    and.push({
      OR: query.companies.map((company) => ({
        company: { contains: company, mode: "insensitive" },
      })),
    });
  if (query.excludeCompanies?.length)
    and.push({
      NOT: query.excludeCompanies.map((company) => ({
        company: { contains: company, mode: "insensitive" },
      })),
    });
  if (query.excludeTitles?.length)
    and.push({
      NOT: query.excludeTitles
        .flatMap(titleVariants)
        .map((title) => ({ title: { contains: title, mode: "insensitive" } })),
    });
  const posted = dateRange(query.postedFrom, query.postedTo, query.postedWithinDays, asOf);
  if (posted)
    and.push(
      query.includeUnknownPostedAt
        ? { OR: [{ postedAt: posted }, { postedAt: null }] }
        : { postedAt: posted },
    );
  const discovered = dateRange(
    query.discoveredFrom,
    query.discoveredTo,
    query.discoveredWithinDays,
    asOf,
  );
  if (discovered) and.push({ firstSeenAt: discovered });
  if (userId && query.activity === "saved") and.push({ savedBy: { some: { userId } } });
  if (userId && query.activity === "applied") and.push({ applications: { some: { userId } } });
  if (userId && query.activity === "not_applied") and.push({ applications: { none: { userId } } });
  if (workModes?.length) and.push({ workMode: { in: workModes } });
  if (employmentTypes?.length) and.push({ employmentKind: { in: employmentTypes } });
  if (hasSalaryRange || salaryCurrency || salaryPeriod) {
    const salary: Prisma.JobListingWhereInput = {
      ...(salaryCurrency && { salaryCurrency }),
      ...(salaryPeriod && { salaryPeriod }),
      ...(salaryMin !== undefined && { salaryMax: { gte: salaryMin } }),
      ...(salaryMax !== undefined && { salaryMin: { lte: salaryMax } }),
    };
    and.push(
      includeUnknownSalary ? { OR: [salary, { salaryMin: null, salaryMax: null }] } : salary,
    );
  }
  return {
    ...(level && { level }),
    ...(status && { status }),
    ...(remote !== undefined && { remote }),
    ...(location && { location: { contains: location, mode: "insensitive" } }),
    ...(skills.length > 0 && { skills: { hasSome: skills } }),
    ...(board && {
      sources: { some: { board: board.toLowerCase(), ...sourceVisibility(userId) } },
    }),
    ...(and.length > 0 && { AND: and }),
  };
}

export function listingOrder(
  sort: AdminJobListingQuery["sort"],
): Prisma.JobListingOrderByWithRelationInput[] {
  const newest: Prisma.JobListingOrderByWithRelationInput[] = [{ listedAt: "desc" }, { id: "asc" }];
  return sort === "salary_desc"
    ? [{ salaryMax: { sort: "desc", nulls: "last" } }, ...newest]
    : newest;
}
