import { buildListingDraft } from "./listing-draft";
import { listingEmploymentKind, listingWorkMode, normalizeListingSalary } from "./listing-metadata";
import { describe, expect, it } from "bun:test";

describe("listing pay normalization", () => {
  it.each([
    ["CA$106,400 - CA$159,600 per year", 106400, 159600, "CAD", "year"],
    ["USD $95k–$120k / yr", 95000, 120000, "USD", "year"],
    ["£45.50 to £55 hourly", 45.5, 55, "GBP", "hour"],
    ["EUR 6000 monthly", 6000, 6000, "EUR", "month"],
  ] as const)("parses explicit currency and period: %s", (text, min, max, currency, period) => {
    expect(normalizeListingSalary(text)).toEqual({
      salaryMin: min,
      salaryMax: max,
      salaryCurrency: currency,
      salaryPeriod: period,
    });
  });
  it.each([
    "$100,000 - $120,000 / year",
    "CA$106,400 - CA$159,600",
    "Competitive",
    "USD 90k–100k year plus 20k bonus",
    "USD 100k CAD 150k year",
    "USD 30/hour or 60000/year",
    "USD 120k–100k year",
    "USD 10,00 yearly",
  ])("leaves ambiguous pay incomparable: %s", (salary) => {
    expect(normalizeListingSalary(salary)).toEqual({
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
    });
  });
});

describe("listing metadata", () => {
  it("keeps an unspecified work arrangement unknown", () => {
    expect(listingWorkMode("Toronto", false)).toBeNull();
    expect(listingWorkMode("Toronto, Remote", false)).toBe("remote");
    expect(listingWorkMode("Toronto (Hybrid)", true)).toBe("hybrid");
    expect(listingWorkMode("On-site, Toronto", false)).toBe("onsite");
  });
  it("normalizes common existing employment labels", () => {
    expect(["FullTime", "Full-time", "full_time"].map(listingEmploymentKind)).toEqual([
      "full_time",
      "full_time",
      "full_time",
    ]);
    expect(listingEmploymentKind("unknown")).toBeNull();
  });
  it("populates metadata in the shared ingestion gate", () => {
    const draft = buildListingDraft({
      publicFeed: true,
      title: "Engineer",
      company: "Example",
      url: "https://example.com/job",
      location: "Toronto, Hybrid",
      type: "FullTime",
      salary: "CAD 100000–120000 annually",
      companyLogoUrl: "https://example.com/logo.png",
    });
    expect(draft).toMatchObject({
      employmentKind: "full_time",
      workMode: "hybrid",
      salaryMin: 100000,
      salaryMax: 120000,
      salaryCurrency: "CAD",
      salaryPeriod: "year",
      companyLogoUrl: "https://example.com/logo.png",
    });
  });
});
