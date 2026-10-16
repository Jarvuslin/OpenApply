import { jobLevelFromTitle, jobListingQuerySchema } from "./job-listing";
import { describe, expect, it } from "bun:test";

describe("job board queries", () => {
  it("recognizes graduate and early-career role labels while preserving seniority precedence", () => {
    for (const title of [
      "New-grad Software Engineer",
      "Software Engineer Newgrad",
      "Graduate Software Engineer",
      "Early-Career Backend Engineer",
    ]) {
      expect(jobLevelFromTitle(title)).toBe("entry");
    }
    expect(jobLevelFromTitle("Senior Graduate Program Engineer")).toBe("senior");
    expect(jobLevelFromTitle("Graduate Research Intern")).toBe("intern");
  });
  it("accepts repeated multi-select filters in both query parser forms", () => {
    const result = jobListingQuerySchema.parse({
      titles: "Software Engineer, AI Engineer",
      locations: ["Toronto", "Canada"],
      levels: "entry,mid",
      workModes: "remote,hybrid",
      employmentTypes: "full_time,contract",
    });
    expect(result).toMatchObject({
      titles: ["Software Engineer", "AI Engineer"],
      locations: ["Toronto", "Canada"],
      levels: ["entry", "mid"],
      workModes: ["remote", "hybrid"],
      employmentTypes: ["full_time", "contract"],
    });
  });
  it("normalizes pay input while keeping currency and period explicit", () => {
    expect(
      jobListingQuerySchema.parse({
        salaryMin: "80000",
        salaryCurrency: "cad",
        salaryPeriod: "year",
        includeUnknownSalary: "true",
      }),
    ).toMatchObject({
      salaryMin: 80000,
      salaryCurrency: "CAD",
      salaryPeriod: "year",
      includeUnknownSalary: true,
    });
    expect(jobListingQuerySchema.safeParse({ salaryMin: "-1" }).success).toBe(false);
    expect(jobListingQuerySchema.safeParse({ salaryPeriod: "weekly" }).success).toBe(false);
  });
  it("preserves existing public query inputs", () => {
    expect(
      jobListingQuerySchema.parse({
        q: "engineer",
        location: "Toronto",
        remote: "false",
        level: "entry",
        tech: "React,TypeScript",
        board: "ashby",
        maxYears: "3",
      }),
    ).toMatchObject({
      q: "engineer",
      location: "Toronto",
      remote: false,
      level: "entry",
      tech: ["React", "TypeScript"],
      board: "ashby",
      maxYears: 3,
    });
  });
});
