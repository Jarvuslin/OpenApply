import { boardConflict, descriptionSimilarity, fuzzyMatch, matchKey } from "./listing-match";
import { greenhouseJobId, postingIdentity } from "./posting-identity";
import { SOURCE_RANK, sourceRank } from "./source-rank";
import { describe, expect, it } from "bun:test";

describe("posting identity", () => {
  it("reads the board and job id from every ATS link shape", () => {
    expect(postingIdentity("https://job-boards.greenhouse.io/Stripe/jobs/123?gh_src=x")).toEqual({
      boardKey: "greenhouse/stripe",
      externalId: "123",
    });
    expect(postingIdentity("https://boards.greenhouse.io/embed/job_app?for=acme&token=9")).toEqual({
      boardKey: "greenhouse/acme",
      externalId: "9",
    });
    expect(postingIdentity("https://jobs.lever.co/palantir/6ed76ce8/apply")?.externalId).toBe(
      "6ed76ce8",
    );
    expect(postingIdentity("https://jobs.ashbyhq.com/openai/8fb1615c/application")).toEqual({
      boardKey: "ashby/openai",
      externalId: "8fb1615c",
    });
    expect(postingIdentity("https://apply.workable.com/huggingface/j/81B46579FE")?.boardKey).toBe(
      "workable/huggingface",
    );
    expect(postingIdentity("https://jobs.smartrecruiters.com/ServiceNow/744000156052424")).toEqual({
      boardKey: "smartrecruiters/servicenow",
      externalId: "744000156052424",
    });
    expect(
      postingIdentity(
        "https://manulife.wd3.myworkdayjobs.com/en-US/MFCJH_adminJobs/job/Waterloo-Ontario/Co-op_JR26081661-1",
      ),
    ).toEqual({
      boardKey: "workday/manulife.wd3.mfcjh_adminjobs",
      externalId: "Co-op_JR26081661-1",
    });
    expect(postingIdentity("https://stripe.com/jobs/search?gh_jid=123")).toBeNull();
    expect(greenhouseJobId("https://stripe.com/jobs/search?gh_jid=123")).toBe("123");
  });
});

describe("source rank", () => {
  it("prefers employer ATS, then career site, then curated list, then aggregator", () => {
    expect(sourceRank("greenhouse")).toBe(SOURCE_RANK.employerAts);
    expect(sourceRank("successfactors")).toBe(SOURCE_RANK.careerSite);
    expect(sourceRank("simplify-new-grad")).toBe(SOURCE_RANK.curatedList);
    expect(sourceRank("hackernews")).toBe(SOURCE_RANK.aggregator);
    expect(sourceRank(null)).toBe(SOURCE_RANK.other);
  });
});

describe("fuzzy match", () => {
  const text =
    "Build payment infrastructure used by millions of businesses. You will design APIs, run services in production and mentor engineers on the team.";
  const listing = (postedAt: string, description: string | null, externalId: string | null) => ({
    postedAt: new Date(postedAt),
    description,
    sources: [{ boardKey: "greenhouse/acme", externalId }],
  });

  it("merges only when dates, description and board ids all agree", () => {
    expect(fuzzyMatch(listing("2026-10-01", text, "1"), listing("2026-10-10", text, null))).toBe(
      true,
    );
    expect(fuzzyMatch(listing("2026-10-01", text, "1"), listing("2026-10-20", text, null))).toBe(
      false,
    );
    expect(fuzzyMatch(listing("2026-10-01", text, "1"), listing("2026-10-02", null, null))).toBe(
      false,
    );
    expect(
      fuzzyMatch(listing("2026-10-01", text, "1"), listing("2026-10-02", "Sell insurance.", null)),
    ).toBe(false);
    expect(fuzzyMatch(listing("2026-10-01", text, "1"), listing("2026-10-02", text, "2"))).toBe(
      false,
    );
  });

  it("never treats two ids on one board as one posting", () => {
    expect(
      boardConflict(
        [{ boardKey: "workday/td.wd3.td_bank_careers", externalId: "A_R1" }],
        [{ boardKey: "workday/td.wd3.td_bank_careers", externalId: "A_R1-1" }],
      ),
    ).toBe(true);
    expect(
      boardConflict(
        [{ boardKey: "greenhouse/acme", externalId: "1" }],
        [{ boardKey: "lever/acme", externalId: "2" }],
      ),
    ).toBe(false);
  });

  it("compares the same title in the same place", () => {
    expect(matchKey("Software Engineer, Payments", "Toronto, ON")).toBe(
      matchKey("software engineer payments", "Toronto"),
    );
    expect(descriptionSimilarity(text, `${text} Apply today.`)).toBe(1);
  });
});
