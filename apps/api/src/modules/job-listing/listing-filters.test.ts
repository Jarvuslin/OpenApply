import { listingFilters, listingOrder } from "./listing-filters";
import { describe, expect, it } from "bun:test";

const page = { page: 1, limit: 25 };

describe("job board SQL filters", () => {
  it("combines roles and locations with OR within each group and AND between groups", () => {
    expect(
      listingFilters(
        {
          ...page,
          titles: ["design", "platform"],
          locations: ["Toronto", "Canada"],
          levels: ["entry", "mid"],
          workModes: ["hybrid", "remote"],
          employmentTypes: ["full_time"],
        },
        [],
      ),
    ).toEqual({
      AND: [
        {
          OR: [
            { title: { contains: "design", mode: "insensitive" } },
            { title: { contains: "platform", mode: "insensitive" } },
          ],
        },
        {
          OR: [
            { location: { contains: "Toronto", mode: "insensitive" } },
            {
              OR: [
                { countries: { has: "CA" } },
                { location: { contains: "Canada", mode: "insensitive" } },
              ],
            },
          ],
        },
        { level: { in: ["entry", "mid"] } },
        { workMode: { in: ["hybrid", "remote"] } },
        { employmentKind: { in: ["full_time"] } },
      ],
    });
  });
  it("compares overlapping salary ranges only in the chosen currency and period", () => {
    const salary = {
      salaryCurrency: "CAD",
      salaryPeriod: "year" as const,
      salaryMin: 90000,
      salaryMax: 150000,
    };
    expect(listingFilters({ ...page, ...salary }, [])).toEqual({
      AND: [
        {
          salaryCurrency: "CAD",
          salaryPeriod: "year",
          salaryMax: { gte: 90000 },
          salaryMin: { lte: 150000 },
        },
      ],
    });
    expect(listingFilters({ ...page, ...salary, includeUnknownSalary: true }, [])).toMatchObject({
      AND: [{ OR: [{ salaryCurrency: "CAD" }, { salaryMin: null, salaryMax: null }] }],
    });
  });
  it("matches common role title spellings without broadening unrelated roles", () => {
    const where = listingFilters(
      { ...page, titles: ["Frontend engineer", "Full-stack developer"] },
      [],
    );
    expect(where).toMatchObject({
      AND: [
        {
          OR: expect.arrayContaining([
            { title: { contains: "front-end engineer", mode: "insensitive" } },
            { title: { contains: "front end engineer", mode: "insensitive" } },
            { title: { contains: "full stack developer", mode: "insensitive" } },
          ]),
        },
      ],
    });
  });
  it("rejects ambiguous cross-currency sorting and impossible pay ranges", () => {
    expect(() => listingFilters({ ...page, salaryMin: 90000 }, [])).toThrow(
      "currency and pay period",
    );
    expect(() => listingFilters({ ...page, sort: "salary_desc" }, [])).toThrow(
      "currency and pay period",
    );
    expect(() =>
      listingFilters(
        {
          ...page,
          salaryMin: 90000,
          salaryMax: 50000,
          salaryCurrency: "CAD",
          salaryPeriod: "year",
        },
        [],
      ),
    ).toThrow("Minimum salary");
  });
  it("does not infer onsite from a false legacy remote flag", () => {
    expect(listingFilters({ ...page, workModes: ["onsite"] }, [])).toEqual({
      AND: [{ workMode: { in: ["onsite"] } }],
    });
  });
  it("uses stable database order for newest and puts unknown pay last", () => {
    expect(listingOrder(undefined)).toEqual([{ listedAt: "desc" }, { id: "asc" }]);
    expect(listingOrder("salary_desc")[0]).toEqual({ salaryMax: { sort: "desc", nulls: "last" } });
  });
});
