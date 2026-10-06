import { jobLevelFromTitle, jobListingQuerySchema } from "@openapply/contracts/job-listing";
import { listedExperience } from "./experience";
import { describe, expect, it } from "bun:test";

describe("job discovery experience filters", () => {
  it("keeps unspecified levels and experience unknown", () => {
    expect(jobLevelFromTitle("Software Engineer")).toBe("unknown");
    expect(listedExperience("We have served customers for 20 years since 2006.")).toBeUndefined();
    expect(jobLevelFromTitle("Staffing Coordinator")).toBe("unknown");
  });
  it("recognizes title levels without treating an intern as a senior role", () => {
    expect(jobLevelFromTitle("Software Engineering Intern")).toBe("intern");
    expect(jobLevelFromTitle("Intermediate Software Engineer")).toBe("mid");
    expect(jobLevelFromTitle("Software Engineer II")).toBe("mid");
    expect(jobLevelFromTitle("New Grad Engineer")).toBe("entry");
    expect(jobLevelFromTitle("Staff / Senior Engineer")).toBe("lead");
    expect(jobLevelFromTitle("Senior Engineering Manager")).toBe("executive");
  });
  it("reads stated minimums, preserves zero and ignores explicit preferences", () => {
    expect(listedExperience("3–5 years of professional software development experience.")).toBe(3);
    expect(listedExperience("0 years of experience required.")).toBe(0);
    expect(listedExperience("5 years of experience preferred.")).toBeUndefined();
    expect(listedExperience("2+ years of experience. 4 years of engineering experience.")).toBe(4);
  });
  it("validates filter inputs including entry-level zero", () => {
    expect(jobListingQuerySchema.parse({ maxYears: "0", level: "entry" }).maxYears).toBe(0);
    expect(jobListingQuerySchema.safeParse({ maxYears: -1 }).success).toBe(false);
    expect(jobListingQuerySchema.safeParse({ level: "random" }).success).toBe(false);
  });
});
