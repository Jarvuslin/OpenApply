import { JOB_LEVELS, type JobListingQuery } from "@openapply/contracts/job-listing";
import { SALARY_CURRENCIES, type UserWithAutoApplyInput } from "@openapply/contracts/user";
import type { DiscoverFilters } from "./job-board-types";

export const EMPTY_FILTERS: DiscoverFilters = {
  titles: [],
  locations: [],
  levels: [],
  workModes: [],
  employmentTypes: [],
  salaryMin: "",
  salaryMax: "",
  salaryCurrency: "USD",
  salaryPeriod: "year",
  includeUnknownSalary: true,
  noExperience: false,
  minYears: "",
  maxYears: "",
  includeUnknownYears: true,
  countries: [],
  companies: [],
  excludeCompanies: [],
  excludeTitles: [],
  includeUnknownLevel: false,
  includeUnknownPostedAt: false,
  activity: "all",
  postedRange: "all",
  postedFrom: "",
  postedTo: "",
  discoveredRange: "all",
  discoveredFrom: "",
  discoveredTo: "",
};

type ProfilePreferences = Pick<
  UserWithAutoApplyInput,
  "jobPreferences" | "preferredLocations" | "city" | "salaryPreferences"
>;

const LEVEL_MAP: Record<string, DiscoverFilters["levels"][number]> = {
  Internship: "intern",
  Entry: "entry",
  "Intermediate / Mid": "mid",
  Senior: "senior",
  Staff: "lead",
  Principal: "lead",
  Manager: "executive",
  "Director+": "executive",
};
const TYPE_MAP: Record<string, DiscoverFilters["employmentTypes"][number]> = {
  "Full-time": "full_time",
  "Part-time": "part_time",
  Contract: "contract",
  Internship: "internship",
};
const ROLE_MAP: Record<string, string[]> = {
  "Software engineering": ["Software engineer"],
  "Data engineering": ["Data engineer"],
  "DevOps / platform": ["DevOps", "Platform engineer"],
  "QA / test": ["QA", "Test engineer", "Quality assurance"],
};

export function filtersFromProfile(profile: ProfilePreferences): DiscoverFilters {
  const preferences = profile.jobPreferences;
  const salary =
    profile.salaryPreferences.find(
      (item) =>
        !preferences?.employmentTypes.length ||
        preferences.employmentTypes.some((type) =>
          item.appliesTo.toLowerCase().includes(type.toLowerCase()),
        ),
    ) ?? profile.salaryPreferences[0];
  const locations = profile.preferredLocations.length
    ? profile.preferredLocations
    : [profile.city ?? ""];
  return {
    ...EMPTY_FILTERS,
    titles: [...new Set(preferences?.roles.flatMap((role) => ROLE_MAP[role] ?? [role]) ?? [])],
    locations: [
      ...new Set(locations.map((value) => value.split(",")[0]?.trim() ?? "").filter(Boolean)),
    ],
    levels: [
      ...new Set(
        (preferences?.levels ?? []).flatMap((level) =>
          LEVEL_MAP[level] ? [LEVEL_MAP[level]] : [],
        ),
      ),
    ],
    workModes: (preferences?.workModes ?? []).map(
      (mode) => mode.toLowerCase() as DiscoverFilters["workModes"][number],
    ),
    employmentTypes: (preferences?.employmentTypes ?? []).flatMap((type) =>
      TYPE_MAP[type] ? [TYPE_MAP[type]] : [],
    ),
    salaryMin: salary?.minAmount == null ? "" : String(salary.minAmount),
    salaryMax: salary?.maxAmount == null ? "" : String(salary.maxAmount),
    salaryCurrency: salary?.currency ?? "USD",
    salaryPeriod: salary?.period === "hourly" ? "hour" : "year",
  };
}

const array = (params: URLSearchParams, key: string): string[] => {
  const raw = params.get(key);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string" && !!value.trim())
      : [];
  } catch {
    return [];
  }
};

export function filtersFromParams(params: URLSearchParams): DiscoverFilters {
  const currency = SALARY_CURRENCIES.find((value) => value === params.get("currency")) ?? "USD";
  const period = params.get("period");
  const activity = params.get("activity");
  return {
    titles: array(params, "titles"),
    locations: array(params, "locations"),
    levels: array(params, "levels").filter((value): value is DiscoverFilters["levels"][number] =>
      JOB_LEVELS.some((level) => level === value),
    ),
    workModes: array(params, "workModes").filter(
      (value): value is DiscoverFilters["workModes"][number] =>
        ["remote", "hybrid", "onsite"].includes(value),
    ),
    employmentTypes: array(params, "employmentTypes").filter(
      (value): value is DiscoverFilters["employmentTypes"][number] =>
        ["full_time", "part_time", "contract", "internship", "temporary"].includes(value),
    ),
    salaryMin: params.get("salaryMin") ?? "",
    salaryMax: params.get("salaryMax") ?? "",
    salaryCurrency: currency,
    salaryPeriod: period === "hour" || period === "month" ? period : "year",
    includeUnknownSalary: params.get("unknownSalary") !== "false",
    noExperience: params.get("noExperience") === "true",
    minYears: params.get("minYears") ?? "",
    maxYears: params.get("maxYears") ?? "",
    includeUnknownYears: params.get("unknownYears") !== "false",
    countries: array(params, "countries").filter(
      (value): value is "CA" | "US" => value === "CA" || value === "US",
    ),
    companies: array(params, "companies"),
    excludeCompanies: array(params, "excludeCompanies"),
    excludeTitles: array(params, "excludeTitles"),
    includeUnknownLevel: params.get("unknownLevel") === "true",
    includeUnknownPostedAt: params.get("unknownPostedAt") === "true",
    activity:
      activity === "applied" || activity === "not_applied" || activity === "saved"
        ? activity
        : "all",
    postedRange: dateRange(params.get("postedRange")),
    postedFrom: params.get("postedFrom") ?? "",
    postedTo: params.get("postedTo") ?? "",
    discoveredRange: dateRange(params.get("discoveredRange")),
    discoveredFrom: params.get("discoveredFrom") ?? "",
    discoveredTo: params.get("discoveredTo") ?? "",
  };
}

function dateRange(value: string | null): DiscoverFilters["postedRange"] {
  if (
    value === "1" ||
    value === "3" ||
    value === "7" ||
    value === "14" ||
    value === "30" ||
    value === "90" ||
    value === "custom"
  )
    return value;
  return "all";
}

export function filtersForMarket(
  filters: DiscoverFilters,
  market: "CA" | "US" | "CA_US" | "US_REMOTE",
): DiscoverFilters {
  let countries: DiscoverFilters["countries"] = ["US"];
  if (market === "CA") countries = ["CA"];
  if (market === "CA_US") countries = ["CA", "US"];
  return {
    ...filters,
    countries,
    locations: [],
    workModes: market === "US_REMOTE" ? ["remote"] : [],
  };
}

export function filterParams(filters: DiscoverFilters): Record<string, string | null> {
  return {
    filters: "custom",
    titles: JSON.stringify(filters.titles),
    locations: JSON.stringify(filters.locations),
    levels: JSON.stringify(filters.levels),
    workModes: JSON.stringify(filters.workModes),
    employmentTypes: JSON.stringify(filters.employmentTypes),
    salaryMin: filters.salaryMin || null,
    salaryMax: filters.salaryMax || null,
    currency: filters.salaryCurrency,
    period: filters.salaryPeriod,
    unknownSalary: String(filters.includeUnknownSalary),
    noExperience: filters.noExperience ? "true" : null,
    minYears: filters.minYears || null,
    maxYears: filters.maxYears || null,
    unknownYears: String(filters.includeUnknownYears),
    countries: JSON.stringify(filters.countries),
    companies: JSON.stringify(filters.companies),
    excludeCompanies: JSON.stringify(filters.excludeCompanies),
    excludeTitles: JSON.stringify(filters.excludeTitles),
    unknownLevel: String(filters.includeUnknownLevel),
    unknownPostedAt: String(filters.includeUnknownPostedAt),
    activity: filters.activity === "all" ? null : filters.activity,
    postedRange: filters.postedRange === "all" ? null : filters.postedRange,
    postedFrom: filters.postedFrom || null,
    postedTo: filters.postedTo || null,
    discoveredRange: filters.discoveredRange === "all" ? null : filters.discoveredRange,
    discoveredFrom: filters.discoveredFrom || null,
    discoveredTo: filters.discoveredTo || null,
  };
}

/** A years filter from its URL text; empty means that end is open. */
export function yearsValue(text: string): number | null {
  return text ? Number(text) : null;
}

export function filterError(filters: DiscoverFilters): string | null {
  for (const [range, from, to] of [
    [filters.postedRange, filters.postedFrom, filters.postedTo],
    [filters.discoveredRange, filters.discoveredFrom, filters.discoveredTo],
  ]) {
    if (range !== "custom") continue;
    if (!from && !to) return "Choose a start or end date for your custom date range.";
    for (const date of [from, to]) {
      if (
        date &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !Number.isFinite(Date.parse(date)) ||
          new Date(date).toISOString().slice(0, 10) !== date)
      )
        return "Enter a valid date.";
    }
    if (from && to && from > to) return "Start date cannot be after end date.";
  }
  for (const value of [filters.salaryMin, filters.salaryMax, filters.minYears, filters.maxYears]) {
    if (value && (!Number.isFinite(Number(value)) || Number(value) < 0))
      return "Enter a valid positive number for salary and experience.";
  }
  for (const years of [filters.minYears, filters.maxYears]) {
    if (years && (!Number.isInteger(Number(years)) || Number(years) > 50))
      return "Required experience must be a whole number between 0 and 50.";
  }
  if (filters.minYears && filters.maxYears && Number(filters.minYears) > Number(filters.maxYears))
    return "Minimum years cannot exceed maximum years.";
  if (
    filters.salaryMin &&
    filters.salaryMax &&
    Number(filters.salaryMin) > Number(filters.salaryMax)
  )
    return "Minimum salary cannot exceed maximum salary.";
  return null;
}

export function listingFilters(filters: DiscoverFilters): Omit<JobListingQuery, "page" | "limit"> {
  const hasSalary = !!(filters.salaryMin || filters.salaryMax);
  return {
    titles: filters.titles.length ? filters.titles : undefined,
    locations: filters.locations.length ? filters.locations : undefined,
    levels: filters.levels.length ? filters.levels : undefined,
    workModes: filters.workModes.length ? filters.workModes : undefined,
    employmentTypes: filters.employmentTypes.length ? filters.employmentTypes : undefined,
    salaryMin: filters.salaryMin ? Number(filters.salaryMin) : undefined,
    salaryMax: filters.salaryMax ? Number(filters.salaryMax) : undefined,
    salaryCurrency: hasSalary ? filters.salaryCurrency : undefined,
    salaryPeriod: hasSalary ? filters.salaryPeriod : undefined,
    includeUnknownSalary: hasSalary ? filters.includeUnknownSalary : undefined,
    noExperience: filters.noExperience || undefined,
    minYears: filters.minYears ? Number(filters.minYears) : undefined,
    maxYears: filters.maxYears ? Number(filters.maxYears) : undefined,
    includeUnknownYears:
      filters.minYears || filters.maxYears ? filters.includeUnknownYears : undefined,
    countries: filters.countries.length ? filters.countries : undefined,
    companies: filters.companies.length ? filters.companies : undefined,
    excludeCompanies: filters.excludeCompanies.length ? filters.excludeCompanies : undefined,
    excludeTitles: filters.excludeTitles.length ? filters.excludeTitles : undefined,
    includeUnknownLevel: filters.levels.length ? filters.includeUnknownLevel : undefined,
    activity: filters.activity === "all" ? undefined : filters.activity,
    includeUnknownPostedAt:
      filters.postedRange !== "all" ? filters.includeUnknownPostedAt : undefined,
    postedFrom:
      filters.postedRange === "custom" && filters.postedFrom ? filters.postedFrom : undefined,
    postedTo: filters.postedRange === "custom" && filters.postedTo ? filters.postedTo : undefined,
    discoveredFrom:
      filters.discoveredRange === "custom" && filters.discoveredFrom
        ? filters.discoveredFrom
        : undefined,
    discoveredTo:
      filters.discoveredRange === "custom" && filters.discoveredTo
        ? filters.discoveredTo
        : undefined,
    postedWithinDays:
      filters.postedRange !== "all" && filters.postedRange !== "custom"
        ? Number(filters.postedRange)
        : undefined,
    discoveredWithinDays:
      filters.discoveredRange !== "all" && filters.discoveredRange !== "custom"
        ? Number(filters.discoveredRange)
        : undefined,
  };
}
