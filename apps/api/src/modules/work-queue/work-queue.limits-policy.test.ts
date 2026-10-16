import { workScope } from "./work-queue.limits-policy";
import { describe, expect, test } from "bun:test";

describe("workScope", () => {
  test("uses the saved company name", () => {
    expect(workScope({ url: "https://example.com/job/1", company: "Acme" })?.companyKey).toBe(
      "acme",
    );
  });

  test("reads the employer from the link when the company is missing", () => {
    const company = (url: string) => workScope({ url, company: "" })?.companyKey;
    expect(company("https://capitalone.wd12.myworkdayjobs.com/Capital_One/job/x")).toBe(
      "capitalone",
    );
    expect(company("https://jobs.ashbyhq.com/cohere/123")).toBe("cohere");
    expect(company("https://careers.stripe.com/jobs/1")).toBe("stripe");
  });
});
