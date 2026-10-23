import {
  linkedinIngestSchema,
  linkedinSettingsInputSchema,
  linkedinSettingsSchema,
} from "./linkedin-discovery";
import { describe, expect, it } from "bun:test";

const job = {
  url: "https://www.linkedin.com/jobs/view/123",
  title: "Junior Engineer",
  company: "Acme",
  location: "Toronto",
};
const run = {
  runId: "00000000-0000-4000-8000-000000000001",
  leaseToken: "a".repeat(64),
  searches: [{ index: 0, status: "ok", pagesFetched: 1, jobs: [job] }],
};

describe("LinkedIn discovery budgets", () => {
  it("defaults conservative settings and validates response dates", () => {
    const parsed = linkedinSettingsInputSchema.parse({
      enabled: true,
      searches: [{ query: "software engineer", location: "Toronto" }],
    });
    expect(parsed.searches[0]).toMatchObject({
      distance: 25,
      experienceLevels: ["entry"],
      maxYearsExperience: 2,
      countries: [],
      remoteOnly: false,
    });
    expect(
      linkedinSettingsSchema.safeParse({
        ...parsed,
        nextRunAt: null,
        lastRunAt: new Date(),
        backoffUntil: null,
        lastRunStatus: null,
        lastCompletedAt: null,
        lastResult: null,
      }).success,
    ).toBe(true);
    expect(linkedinSettingsInputSchema.safeParse({ enabled: true, searches: [] }).success).toBe(
      false,
    );
    expect(
      linkedinSettingsInputSchema.safeParse({
        ...parsed,
        searches: Array(5).fill(parsed.searches[0]),
      }).success,
    ).toBe(false);
  });
  it("rejects client apply URLs and non-LinkedIn or unsafe input URLs", () => {
    expect(
      linkedinIngestSchema.safeParse({
        ...run,
        searches: [
          { ...run.searches[0], jobs: [{ ...job, applyUrl: "https://attacker.example/apply" }] },
        ],
      }).success,
    ).toBe(false);
    for (const url of [
      "http://www.linkedin.com/jobs/view/123",
      "https://evil.linkedin.com/jobs/view/123",
      "https://www.linkedin.com.evil.test/jobs/view/123",
      "https://www.linkedin.com/jobs/search",
      "https://u:p@www.linkedin.com/jobs/view/123",
    ])
      expect(
        linkedinIngestSchema.safeParse({
          ...run,
          searches: [{ ...run.searches[0], jobs: [{ ...job, url }] }],
        }).success,
      ).toBe(false);
  });
  it("enforces result, page, search and unique-index limits", () => {
    expect(
      linkedinIngestSchema.safeParse({
        ...run,
        searches: [{ ...run.searches[0], jobs: Array(51).fill(job) }],
      }).success,
    ).toBe(false);
    expect(
      linkedinIngestSchema.safeParse({
        ...run,
        searches: [{ ...run.searches[0], pagesFetched: 6 }],
      }).success,
    ).toBe(false);
    expect(
      linkedinIngestSchema.safeParse({ ...run, searches: Array(5).fill(run.searches[0]) }).success,
    ).toBe(false);
    expect(
      linkedinIngestSchema.safeParse({ ...run, searches: [run.searches[0], run.searches[0]] })
        .success,
    ).toBe(false);
    expect(
      linkedinIngestSchema.parse({
        ...run,
        searches: [0, 1, 2, 3].map((index) => ({
          ...run.searches[0],
          index,
          pagesFetched: 5,
          jobs: Array(50).fill(job),
        })),
      }).searches,
    ).toHaveLength(4);
  });
});
