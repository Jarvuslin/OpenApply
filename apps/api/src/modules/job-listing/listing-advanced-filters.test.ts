import { jobListingQuerySchema } from "@openapply/contracts/job-listing";
import type { Prisma } from "@/generated/prisma/client";
import { listingFilters } from "./listing-filters";
import { describe, expect, it, spyOn } from "bun:test";

const page = { page: 1, limit: 25 };

describe("Discover activity, geography and date filters", () => {
  it("keeps country, workplace and city constraints explicit and intersects them", () => {
    expect(
      listingFilters(
        { ...page, countries: ["US"], workModes: ["remote"], locations: ["New York"] },
        [],
      ),
    ).toEqual({
      AND: [
        { OR: [{ location: { contains: "New York", mode: "insensitive" } }] },
        { countries: { hasSome: ["US"] } },
        { workMode: { in: ["remote"] } },
      ],
    });
  });
  it("includes unspecified levels only when explicitly requested", () => {
    expect(listingFilters({ ...page, levels: ["entry"], includeUnknownLevel: true }, [])).toEqual({
      AND: [{ level: { in: ["entry", "unknown"] } }],
    });
    expect(listingFilters({ ...page, includeUnknownLevel: true }, [])).toEqual({});
  });
  it("scopes every activity filter to the current user and never exposes it publicly", () => {
    expect(listingFilters({ ...page, activity: "applied" }, [], "alice")).toEqual({
      AND: [{ applications: { some: { userId: "alice" } } }],
    });
    expect(listingFilters({ ...page, activity: "not_applied" }, [], "bob")).toEqual({
      AND: [{ applications: { none: { userId: "bob" } } }],
    });
    expect(listingFilters({ ...page, activity: "saved" }, [], "alice")).toEqual({
      AND: [{ savedBy: { some: { userId: "alice" } } }],
    });
    expect(listingFilters({ ...page, activity: "applied" }, [])).toEqual({});
  });
  it("uses original posting date and first-seen date independently with inclusive custom end dates", () => {
    expect(
      listingFilters(
        {
          ...page,
          postedFrom: "2026-10-01",
          postedTo: "2026-10-07",
          discoveredFrom: "2026-10-02",
          includeUnknownPostedAt: true,
        },
        [],
      ),
    ).toEqual({
      AND: [
        {
          OR: [
            {
              postedAt: {
                gte: new Date("2026-10-01T00:00:00Z"),
                lt: new Date("2026-10-08T00:00:00Z"),
              },
            },
            { postedAt: null },
          ],
        },
        { firstSeenAt: { gte: new Date("2026-10-02T00:00:00Z") } },
      ],
    });
  });
  it("treats Past 24 hours as a rolling interval rather than calendar midnight", () => {
    const now = spyOn(Date, "now").mockReturnValue(new Date("2026-10-07T16:25:00Z").getTime());
    try {
      expect(listingFilters({ ...page, postedWithinDays: 1 }, [])).toEqual({
        AND: [{ postedAt: { gte: new Date("2026-10-06T16:25:00Z") } }],
      });
    } finally {
      now.mockRestore();
    }
  });
  it("rejects ambiguous or invalid date queries without widening results", () => {
    expect(() =>
      listingFilters({ ...page, postedWithinDays: 7, postedFrom: "2026-10-01" }, []),
    ).toThrow("preset or a custom");
    expect(() =>
      listingFilters({ ...page, discoveredFrom: "2026-10-07", discoveredTo: "2026-10-01" }, []),
    ).toThrow("Start date");
    expect(jobListingQuerySchema.safeParse({ postedFrom: "2026-02-31" }).success).toBe(false);
    expect(jobListingQuerySchema.safeParse({ postedWithinDays: 0 }).success).toBe(false);
  });
  it("applies employer exclusions and all title spelling variants before pagination", () => {
    const query = jobListingQuerySchema.parse({
      companies: '["Example, Inc"]',
      excludeCompanies: "Agency",
      excludeTitles: "frontend",
    });
    expect(listingFilters(query, [])).toEqual({
      AND: [
        { OR: [{ company: { contains: "Example, Inc", mode: "insensitive" } }] },
        { NOT: [{ company: { contains: "Agency", mode: "insensitive" } }] },
        {
          NOT: ["frontend", "front-end", "front end"].map((title) => ({
            title: { contains: title, mode: "insensitive" },
          })),
        },
      ],
    });
  });
});

describe("Experience filters", () => {
  const noExperience: Prisma.JobListingWhereInput = {
    OR: [{ yearsExperience: 0 }, { level: "intern" }, { level: "entry", yearsExperience: null }],
  };

  it("adds no-prior-experience jobs alongside the picked levels", () => {
    expect(listingFilters({ ...page, levels: ["senior"], noExperience: true }, [])).toEqual({
      AND: [{ OR: [{ level: { in: ["senior"] } }, noExperience] }],
    });
  });

  it("keeps a years range, and postings that name no years only on request", () => {
    expect(listingFilters({ ...page, minYears: 2, maxYears: 5 }, [])).toEqual({
      AND: [{ yearsExperience: { gte: 2, lte: 5 } }],
    });
    expect(listingFilters({ ...page, maxYears: 3, includeUnknownYears: true }, [])).toEqual({
      AND: [{ OR: [{ yearsExperience: { lte: 3 } }, { yearsExperience: null }] }],
    });
  });
});
