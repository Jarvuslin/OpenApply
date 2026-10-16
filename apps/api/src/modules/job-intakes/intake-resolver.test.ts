import type { PrismaClient } from "@/generated/prisma/client";
import { resolveIntake } from "./intake-resolver";
import { describe, expect, it } from "bun:test";

function fixture(source: unknown = null) {
  const lookups: unknown[] = [];
  const prisma = {
    jobListingSource: {
      findFirst: async (input: unknown) => {
        lookups.push(input);
        return source;
      },
    },
  } as unknown as PrismaClient;
  return { prisma, lookups };
}

describe("bounded intake resolution", () => {
  it("does not fetch arbitrary incoming employer URLs", async () => {
    const { prisma, lookups } = fixture();
    let calls = 0;
    const result = await resolveIntake(
      prisma,
      "user-a",
      "https://careers.example.test/jobs/1",
      async () => {
        calls++;
        throw Error("Unexpected fetch");
      },
    );
    expect(calls).toBe(0);
    expect(result).toMatchObject({
      resolved: false,
      canonicalUrl: "https://careers.example.test/jobs/1",
      description: null,
    });
    expect(lookups).toEqual([
      {
        where: {
          AND: [
            {
              OR: [
                { isPublic: true },
                { listing: { personalDiscoveries: { some: { userId: "user-a" } } } },
              ],
            },
            { listing: { status: "published" } },
            {
              OR: [
                { url: "https://careers.example.test/jobs/1" },
                { applyUrl: "https://careers.example.test/jobs/1" },
                { attributionUrl: "https://careers.example.test/jobs/1" },
              ],
            },
          ],
        },
        include: { listing: true },
      },
    ]);
  });

  it("resolves only the exact Greenhouse posting from one fixed public feed", async () => {
    const { prisma } = fixture();
    const urls: string[] = [];
    const result = await resolveIntake(
      prisma,
      "user-a",
      "https://boards.greenhouse.io/acme/jobs/42?gh_src=chat",
      async (url) => {
        urls.push(url);
        return {
          jobs: [
            {
              id: 41,
              title: "Other role",
              absolute_url: "https://boards.greenhouse.io/acme/jobs/41",
              location: { name: "Remote" },
              content: "Not the requested role",
            },
            {
              id: 42,
              title: "Engineer",
              absolute_url: "https://boards.greenhouse.io/acme/jobs/42",
              location: { name: "Toronto" },
              content: "<p>Build products.</p>",
            },
          ],
        };
      },
    );
    expect(urls).toEqual(["https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true"]);
    expect(result).toMatchObject({
      resolved: true,
      title: "Engineer",
      company: "acme",
      description: "Build products.",
      canonicalUrl: "https://boards.greenhouse.io/acme/jobs/42",
    });
  });

  it.each(["lever", "ashby"] as const)(
    "resolves %s posting and form aliases to one identity",
    async (board) => {
      const { prisma } = fixture();
      const urls: string[] = [];
      const jobUrl =
        board === "lever" ? "https://jobs.lever.co/acme/42" : "https://jobs.ashbyhq.com/acme/42";
      const applyUrl = `${jobUrl}/${board === "lever" ? "apply" : "application"}`;
      const result = await resolveIntake(prisma, "user-a", applyUrl, async (url) => {
        urls.push(url);
        return board === "lever"
          ? [
              {
                id: "42",
                text: "Engineer",
                hostedUrl: jobUrl,
                applyUrl,
                descriptionPlain: "Build products.",
              },
            ]
          : {
              jobs: [
                {
                  id: "42",
                  title: "Engineer",
                  location: "Toronto",
                  jobUrl,
                  applyUrl,
                  descriptionPlain: "Build products.",
                },
              ],
            };
      });
      expect(urls).toEqual([
        board === "lever"
          ? "https://api.lever.co/v0/postings/acme?mode=json&skip=0&limit=100"
          : "https://api.ashbyhq.com/posting-api/job-board/acme?includeCompensation=true",
      ]);
      expect(result).toMatchObject({
        resolved: true,
        canonicalUrl: jobUrl,
        title: "Engineer",
        description: "Build products.",
      });
    },
  );

  it("leaves a failed or unmatched ATS lookup unresolved without retrying", async () => {
    for (const response of ["throw", "unmatched"] as const) {
      const { prisma } = fixture();
      let calls = 0;
      const result = await resolveIntake(
        prisma,
        "user-a",
        "https://boards.greenhouse.io/acme/jobs/42",
        async () => {
          calls++;
          if (response === "throw") throw Error("Fixture transport failed");
          return {
            jobs: [
              {
                id: 41,
                title: "Other",
                absolute_url: "https://boards.greenhouse.io/acme/jobs/41",
                location: { name: "Remote" },
              },
            ],
          };
        },
      );
      expect(calls).toBe(1);
      expect(result).toMatchObject({
        resolved: false,
        description: null,
        title: "Job link awaiting preparation",
      });
    }
  });

  it("uses visible Discover apply targets without fetching an arbitrary web page", async () => {
    const { prisma } = fixture({
      applyUrl: "https://careers.example.test/jobs/42",
      board: "employer",
      listing: {
        title: "Saved role",
        company: "Acme",
        location: "Toronto",
        description: "Unverified snapshot text",
      },
    });
    let calls = 0;
    const result = await resolveIntake(
      prisma,
      "user-a",
      "https://discovery.example.test/job/42",
      async () => {
        calls++;
        return {};
      },
    );
    expect(calls).toBe(0);
    expect(result).toMatchObject({
      canonicalUrl: "https://careers.example.test/jobs/42",
      resolved: true,
      title: "Saved role",
      company: "Acme",
      description: null,
    });
  });

  it("does not fetch an unrecognized host or malformed board slug", async () => {
    for (const url of [
      "https://jobs.lever.co.attacker.test/acme/42",
      "https://jobs.lever.co/acme%2Fother/42",
    ]) {
      const { prisma } = fixture();
      let calls = 0;
      expect(
        (
          await resolveIntake(prisma, "user-a", url, async () => {
            calls++;
            return {};
          })
        ).resolved,
      ).toBe(false);
      expect(calls).toBe(0);
    }
  });
});
