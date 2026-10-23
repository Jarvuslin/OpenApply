import { buildListingDraft, type ListingSourceJob } from "./listing-draft";
import { describe, expect, it } from "bun:test";

const job: ListingSourceJob = {
  title: "Software Engineer",
  company: "Google",
  url: "https://www.google.com/about/careers/applications/jobs/results/123-software-engineer",
  level: "entry",
  digest: JSON.stringify({ skills: ["TypeScript"] }),
};

describe("trusted source experience level", () => {
  it("fills an unknown title level only from a validated public feed", () => {
    expect(buildListingDraft({ ...job, publicFeed: true })?.level).toBe("entry");
    expect(buildListingDraft(job)?.level).toBe("unknown");
    expect(buildListingDraft({ ...job, publicFeed: false })?.level).toBe("unknown");
    expect(buildListingDraft({ ...job, level: undefined, publicFeed: true })?.level).toBe(
      "unknown",
    );
  });
  it.each([
    ["Senior Software Engineer", "senior"],
    ["Lead Software Engineer", "lead"],
    ["Software Engineering Intern", "intern"],
  ] as const)("preserves the explicit title level in %s", (title, level) => {
    expect(buildListingDraft({ ...job, title, publicFeed: true })?.level).toBe(level);
  });
});
