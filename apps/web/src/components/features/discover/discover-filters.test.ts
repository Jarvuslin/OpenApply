import { USER_DEFAULT_VALUES } from "@openapply/contracts/user";
import {
  EMPTY_FILTERS,
  filterError,
  filterParams,
  filtersForMarket,
  filtersFromParams,
  filtersFromProfile,
  listingFilters,
} from "./discover-filters";
import { describe, expect, test } from "bun:test";

describe("Discover profile defaults", () => {
  test("copies explicit preferences without reading a resume or modifying the profile", () => {
    const profile = structuredClone(USER_DEFAULT_VALUES);
    profile.jobPreferences = {
      roles: ["Software engineering", "Frontend"],
      levels: ["Entry"],
      workModes: ["Remote", "Hybrid"],
      employmentTypes: ["Full-time"],
      yearsExperience: 2,
    };
    profile.preferredLocations = ["Toronto, Ontario, Canada", "Vancouver"];
    profile.salaryPreferences = [
      {
        appliesTo: "Full-time",
        minAmount: 80000,
        maxAmount: null,
        currency: "CAD",
        period: "yearly",
      },
    ];
    const before = structuredClone(profile);
    const filters = filtersFromProfile(profile);
    expect(filters).toMatchObject({
      titles: ["Software engineer", "Frontend"],
      levels: ["entry"],
      workModes: ["remote", "hybrid"],
      employmentTypes: ["full_time"],
      locations: ["Toronto", "Vancouver"],
      salaryMin: "80000",
      salaryCurrency: "CAD",
      salaryPeriod: "year",
      maxYears: "",
    });
    filters.titles.push("AI engineer");
    filters.locations.length = 0;
    expect(profile).toEqual(before);
    expect(filtersFromProfile(profile).titles).toEqual(["Software engineer", "Frontend"]);
  });
  test("unrestricted roles remain unrestricted, regardless of previous employment", () => {
    expect(filtersFromProfile(USER_DEFAULT_VALUES).titles).toEqual([]);
  });
  test("preserves each role in grouped profile preferences", () => {
    const profile = structuredClone(USER_DEFAULT_VALUES);
    profile.jobPreferences = {
      roles: ["DevOps / platform", "QA / test"],
      levels: [],
      workModes: [],
      employmentTypes: [],
      yearsExperience: null,
    };
    expect(filtersFromProfile(profile).titles).toEqual([
      "DevOps",
      "Platform engineer",
      "QA",
      "Test engineer",
      "Quality assurance",
    ]);
  });
});

describe("independent search filters", () => {
  test("URL survives refresh including cleared defaults and comma-containing locations", () => {
    const filters = { ...EMPTY_FILTERS, locations: ["London, UK"], salaryCurrency: "CAD" as const };
    const entries = Object.entries(filterParams(filters)).filter(
      (entry): entry is [string, string] => entry[1] !== null,
    );
    expect(filtersFromParams(new URLSearchParams(entries))).toEqual(filters);
  });
  test("ignores unsupported levels and invalid enum values in URLs", () => {
    const params = new URLSearchParams({
      levels: '["entry","invalid"]',
      workModes: '["remote","invalid"]',
      employmentTypes: "bad json",
    });
    expect(filtersFromParams(params)).toMatchObject({
      levels: ["entry"],
      workModes: ["remote"],
      employmentTypes: [],
    });
  });
  test("sends currency and period with salary ranges, never profile or resume ids", () => {
    const query = listingFilters({
      ...EMPTY_FILTERS,
      salaryMin: "45",
      salaryPeriod: "hour",
      salaryCurrency: "CAD",
    });
    expect(query).toMatchObject({
      salaryMin: 45,
      salaryCurrency: "CAD",
      salaryPeriod: "hour",
      includeUnknownSalary: true,
    });
    expect(Object.keys(query)).not.toContain("resumeId");
    expect(listingFilters(EMPTY_FILTERS).salaryCurrency).toBeUndefined();
  });
  test("rejects inverted or invalid ranges before querying", () => {
    expect(
      filterError({ ...EMPTY_FILTERS, salaryMin: "90000", salaryMax: "50000" }),
    ).not.toBeNull();
    expect(filterError({ ...EMPTY_FILTERS, salaryMin: "NaN" })).not.toBeNull();
    expect(filterError({ ...EMPTY_FILTERS, maxYears: "2.5" })).not.toBeNull();
  });
  test("round trips activity, country, exclusions and independent date filters", () => {
    const filters = {
      ...EMPTY_FILTERS,
      countries: ["CA", "US"] as ("CA" | "US")[],
      companies: ["Example, Inc.", "Cohere"],
      excludeCompanies: ["Example Staffing"],
      excludeTitles: ["Sales", "Account manager"],
      activity: "not_applied" as const,
      includeUnknownLevel: true,
      includeUnknownPostedAt: true,
      postedRange: "7" as const,
      discoveredRange: "custom" as const,
      discoveredFrom: "2026-09-01",
      discoveredTo: "2026-10-07",
    };
    const params = new URLSearchParams(
      Object.entries(filterParams(filters)).filter(
        (entry): entry is [string, string] => entry[1] !== null,
      ),
    );
    expect(filtersFromParams(params)).toEqual(filters);
    expect(listingFilters(filters)).toMatchObject({
      countries: ["CA", "US"],
      companies: ["Example, Inc.", "Cohere"],
      activity: "not_applied",
      postedWithinDays: 7,
      discoveredFrom: "2026-09-01",
      discoveredTo: "2026-10-07",
      includeUnknownPostedAt: true,
    });
  });
  test("date presets do not leak an inactive custom date range", () => {
    expect(
      listingFilters({ ...EMPTY_FILTERS, postedRange: "1", postedFrom: "2020-01-01" }),
    ).toMatchObject({ postedWithinDays: 1, postedFrom: undefined });
    expect(
      listingFilters({ ...EMPTY_FILTERS, postedRange: "all", includeUnknownPostedAt: true }),
    ).toMatchObject({ postedWithinDays: undefined, includeUnknownPostedAt: undefined });
  });
  test("rejects invalid and reversed calendar ranges and allows open bounds", () => {
    expect(filterError({ ...EMPTY_FILTERS, postedRange: "custom" })).not.toBeNull();
    expect(
      filterError({ ...EMPTY_FILTERS, postedRange: "custom", postedFrom: "2026-02-30" }),
    ).not.toBeNull();
    expect(
      filterError({
        ...EMPTY_FILTERS,
        discoveredRange: "custom",
        discoveredFrom: "2026-10-07",
        discoveredTo: "2026-10-01",
      }),
    ).not.toBeNull();
    expect(
      filterError({ ...EMPTY_FILTERS, postedRange: "custom", postedTo: "2026-10-07" }),
    ).toBeNull();
  });
  test("invalid activity and country URL values never reach the API", () => {
    expect(
      filtersFromParams(
        new URLSearchParams({
          countries: '["US","FR","CA"]',
          activity: "everything",
          postedRange: "yesterday",
        }),
      ),
    ).toMatchObject({ countries: ["US", "CA"], activity: "all", postedRange: "all" });
  });
  test("US remote replaces restrictive location and workplace while preserving role preferences", () => {
    const profileFilters = {
      ...EMPTY_FILTERS,
      locations: ["Toronto"],
      levels: ["entry"] as const,
      workModes: ["onsite"] as const,
    };
    const filters = {
      ...profileFilters,
      levels: [...profileFilters.levels],
      workModes: [...profileFilters.workModes],
    };
    const next = filtersForMarket(filters, "US_REMOTE");
    expect(next).toMatchObject({
      countries: ["US"],
      locations: [],
      workModes: ["remote"],
      levels: ["entry"],
    });
    expect(filters.locations).toEqual(["Toronto"]);
    expect(filtersForMarket(next, "CA_US")).toMatchObject({
      countries: ["CA", "US"],
      locations: [],
      workModes: [],
    });
  });
});
