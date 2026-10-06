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
  expect(matchEmployerJob(job, [candidate])).toEqual({ applyUrl: candidate.url, confidence: 1 }));
it("keeps uncertain locations, weak titles and ambiguous matches unqueueable", () => {
  expect(matchEmployerJob(job, [{ ...candidate, location: "Vancouver" }]).applyUrl).toBeNull();
  expect(matchEmployerJob(job, [{ ...candidate, title: "Sales Manager" }]).applyUrl).toBeNull();
  expect(
    matchEmployerJob(job, [candidate, { ...candidate, url: "https://jobs.lever.co/acme/2" }])
      .applyUrl,
  ).toBeNull();
  expect(matchEmployerJob(job, []).applyUrl).toBeNull();
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
