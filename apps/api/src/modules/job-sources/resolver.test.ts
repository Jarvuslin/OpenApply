import type { PrismaClient } from "@/generated/prisma/client";
import { EmployerResolver, matchEmployerJob } from "./resolver";
import type { SourceJob } from "./types";
import { expect, it } from "bun:test";

const job: SourceJob = {
  title: "Software Engineer",
  company: "Acme",
  location: "Toronto",
  url: "https://indeed.com/1",
  attributionUrl: "https://indeed.com/1",
  description: "",
  postedAt: null,
};
const candidate = { ...job, url: "https://jobs.lever.co/acme/1" };
it("resolves a strong title and location match", () =>
  expect(matchEmployerJob(job, [candidate])).toEqual({
    applyUrl: candidate.url,
    confidence: 1,
    matchedJob: candidate,
  }));
it("keeps uncertain locations, weak titles and ambiguous matches unqueueable", () => {
  expect(matchEmployerJob(job, [{ ...candidate, location: "Vancouver" }]).applyUrl).toBeNull();
  expect(matchEmployerJob(job, [{ ...candidate, title: "Sales Manager" }]).applyUrl).toBeNull();
  expect(
    matchEmployerJob(job, [candidate, { ...candidate, url: "https://jobs.lever.co/acme/2" }])
      .applyUrl,
  ).toBeNull();
  expect(matchEmployerJob(job, []).applyUrl).toBeNull();
});
it("matches a verified city and province abbreviation without relaxing title confidence", () => {
  const toronto = { ...job, location: "Toronto, Ontario, Canada" };
  const employer = { ...candidate, location: "Toronto, ON, Saskatoon, SK" };
  expect(matchEmployerJob(toronto, [employer]).confidence).toBe(1);
  expect(matchEmployerJob(toronto, [employer]).applyUrl).toBe(candidate.url);
  expect(
    matchEmployerJob(toronto, [{ ...employer, title: "Senior Software Engineer" }]).applyUrl,
  ).toBeNull();
  expect(
    matchEmployerJob(toronto, [{ ...employer, location: "Toronto, Quebec, Canada" }]).applyUrl,
  ).toBeNull();
  expect(
    matchEmployerJob(toronto, [employer, { ...employer, url: `${employer.url}2` }]).applyUrl,
  ).toBeNull();
});
it("uses a direct employer URL without probing", async () => {
  const result = await new EmployerResolver({} as PrismaClient).resolve(candidate, async () => {
    throw new Error("unexpected fetch");
  });
  expect(result.applyUrl).toBe(candidate.url);
});
it("never caches an empty guessed board", async () => {
  let writes = 0;
  const db = {
    jobListingSource: { findMany: async () => [] },
    companyAtsBoard: {
      findUnique: async () => null,
      upsert: async () => {
        writes++;
      },
    },
  } as unknown as PrismaClient;
  const result = await new EmployerResolver(db).resolve(job, async (url) =>
    url.includes("lever.co")
      ? []
      : url.includes("smartrecruiters")
        ? { content: [] }
        : { jobs: [] },
  );
  expect(result.applyUrl).toBeNull();
  expect(writes).toBe(0);
});

it("uses a known employer catalog slug before guessed boards and returns full ATS metadata", async () => {
  const urls: string[] = [];
  const employer = { ...job, company: "DoorDash" };
  const db = {
    companyAtsBoard: { findUnique: async () => null, upsert: async () => ({}) },
    jobListingSource: { findMany: async () => [] },
  } as unknown as PrismaClient;
  const result = await new EmployerResolver(db).resolve(employer, async (url) => {
    urls.push(url);
    return {
      jobs: [
        {
          title: employer.title,
          absolute_url: "https://job-boards.greenhouse.io/doordashusa/jobs/123",
          location: { name: employer.location },
          content: "<p>Complete employer description with required skills.</p>",
        },
      ],
    };
  });
  expect(urls).toHaveLength(1);
  expect(urls[0]).toContain("/doordashusa/");
  expect(result.matchedJob?.description).toBe(
    "Complete employer description with required skills.",
  );
});

it("uses ATS sources already stored for the company before guessed names", async () => {
  const urls: string[] = [];
  const db = {
    companyAtsBoard: { findUnique: async () => null, upsert: async () => ({}) },
    jobListingSource: {
      findMany: async () => [{ url: "https://jobs.lever.co/acme-official/42", applyUrl: null }],
    },
  } as unknown as PrismaClient;
  const result = await new EmployerResolver(db).resolve(job, async (url) => {
    urls.push(url);
    return [
      {
        text: job.title,
        hostedUrl: "https://jobs.lever.co/acme-official/123",
        categories: { location: job.location },
        descriptionPlain: "Full requirements",
      },
    ];
  });
  expect(urls[0]).toContain("/acme-official?");
  expect(result.matchedJob?.description).toBe("Full requirements");
});
