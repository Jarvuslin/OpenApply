import { companyDomain } from "./company-logo";
import { describe, expect, it } from "bun:test";

describe("companyDomain", () => {
  it("uses the employer's own site", () => {
    expect(companyDomain("https://careers.stripe.com/jobs/1")).toBe("stripe.com");
    expect(companyDomain("https://www.shopify.com/careers/x")).toBe("shopify.com");
  });

  it("guesses from an applicant tracking system's company slug", () => {
    expect(companyDomain("https://capitalone.wd12.myworkdayjobs.com/Capital_One/job/x")).toBe(
      "capitalone.com",
    );
    expect(companyDomain("https://jobs.ashbyhq.com/cohere/123/application")).toBe("cohere.com");
    expect(companyDomain("https://boards.greenhouse.io/figma/jobs/1")).toBe("figma.com");
  });

  it("gives nothing when there is no link", () => {
    expect(companyDomain(null)).toBeNull();
    expect(companyDomain("not a url")).toBeNull();
  });
});
