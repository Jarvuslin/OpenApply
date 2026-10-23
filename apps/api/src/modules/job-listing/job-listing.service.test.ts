import type { PrismaClient } from "@/generated/prisma/client";
import { discoverJobListingPageSchema, jobListingPageSchema } from "./job-listing.schema";
import { JobListingService } from "./job-listing.service";
import { describe, expect, it } from "bun:test";

function fakeListings() {
  const saved = new Set<string>();
  const queries: { operation: string; args: Record<string, unknown> }[] = [];
  const row = {
    id: "22a4f706-c3dd-4d25-8e21-3c52373506c7",
    slug: "example-engineer",
    title: "Engineer",
    company: "Example",
    level: "entry",
    yearsExperience: null,
    location: "Toronto",
    countries: ["CA"],
    remote: false,
    workMode: null,
    salary: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    employmentType: "Full-time",
    employmentKind: "full_time",
    companyLogoUrl: null,
    postedAt: null,
    listedAt: new Date(),
    skills: ["TypeScript"],
    descriptionExcerpt: "Build interfaces.",
    firstSeenAt: new Date(),
    lastSeenAt: new Date(),
    requirements: [],
    responsibilities: [],
    _count: { sources: 1 },
    sources: [
      {
        url: "https://example.com/careers/1",
        applyUrl: "https://example.com/careers/1",
        board: "employer",
      },
    ],
    applications: [],
  };
  let hidden = false;
  const prisma = {
    application: { findMany: async () => [] },
    jobListing: {
      findFirst: async (args: { where: { status?: string } }) => {
        queries.push({ operation: "findFirst", args });
        return hidden && args.where.status === "published" ? null : row;
      },
      findMany: async (args: {
        select: { savedBy?: { where: { userId: string } }; slug?: boolean; title?: boolean };
      }) => {
        queries.push({ operation: "findMany", args });
        if (args.select.slug && !args.select.title) return [{ slug: row.slug }];
        const ownSaved = args.select.savedBy;
        return [
          {
            ...row,
            ...(ownSaved && {
              savedBy: saved.has(`${ownSaved.where.userId}/${row.id}`)
                ? [{ savedAt: new Date() }]
                : [],
            }),
          },
        ];
      },
      count: async (args: Record<string, unknown>) => {
        queries.push({ operation: "count", args });
        return 81;
      },
    },
    savedJobListing: {
      createMany: async (args: {
        data: { userId: string; listingId: string }[];
        skipDuplicates: boolean;
      }) => {
        queries.push({ operation: "save", args });
        for (const item of args.data) saved.add(`${item.userId}/${item.listingId}`);
      },
      deleteMany: async (args: { where: { userId: string; listingId: string } }) => {
        queries.push({ operation: "unsave", args });
        saved.delete(`${args.where.userId}/${args.where.listingId}`);
      },
      count: async (args: { where: { userId: string } }) => {
        queries.push({ operation: "savedCount", args });
        return [...saved].filter((key) => key.startsWith(`${args.where.userId}/`)).length;
      },
      findMany: async (args: Record<string, unknown>) => {
        queries.push({ operation: "savedMany", args });
        return [{ listing: row, savedAt: new Date() }];
      },
      findUnique: async (args: {
        where: { userId_listingId: { userId: string; listingId: string } };
      }) => {
        const key = args.where.userId_listingId;
        return saved.has(`${key.userId}/${key.listingId}`) ? { savedAt: new Date() } : null;
      },
    },
  } as unknown as PrismaClient;
  return {
    service: new JobListingService(prisma),
    queries,
    saved,
    row,
    hide: () => {
      hidden = true;
    },
  };
}

describe("saved job ownership", () => {
  it("saves idempotently and never removes another user's saved job", async () => {
    const { service, saved, row, queries } = fakeListings();
    expect(await service.setSaved("alice", row.slug, true)).toEqual({
      slug: row.slug,
      isSaved: true,
      savedCount: 1,
    });
    await service.setSaved("alice", row.slug, true);
    await service.setSaved("bob", row.slug, true);
    expect(saved.size).toBe(2);
    expect(queries.find((query) => query.operation === "save")?.args).toMatchObject({
      skipDuplicates: true,
    });
    expect(await service.setSaved("alice", row.slug, false)).toMatchObject({
      isSaved: false,
      savedCount: 0,
    });
    await service.setSaved("alice", row.slug, false);
    expect((await service.savedCount("bob")).count).toBe(1);
  });
  it("rejects saving a hidden listing but permits removal of an old save", async () => {
    const { service, row, hide } = fakeListings();
    await service.setSaved("alice", row.slug, true);
    hide();
    expect(service.setSaved("bob", row.slug, true)).rejects.toThrow("not found");
    expect(await service.setSaved("alice", row.slug, false)).toMatchObject({ isSaved: false });
  });
  it("scopes saved listing pages, counts and handoff pages to the authenticated user", async () => {
    const { service, queries } = fakeListings();
    const page = { page: 2, limit: 20, titles: ["Engineer"] };
    await service.saved("alice", page);
    expect(queries.find((query) => query.operation === "savedMany")?.args).toMatchObject({
      where: {
        userId: "alice",
        listing: {
          // A saved job that expired stays on the saved page.
          status: { in: ["published", "expired"] },
          AND: expect.arrayContaining([
            { OR: [{ title: { contains: "Engineer", mode: "insensitive" } }] },
          ]),
        },
      },
      skip: 20,
      take: 20,
    });
    await service.savedSlugs("alice", page);
    expect(queries.find((query) => query.operation === "findMany")?.args).toMatchObject({
      where: {
        status: { in: ["published", "expired"] },
        savedBy: { some: { userId: "alice" } },
        applications: { none: { userId: "alice" } },
      },
      skip: 20,
      take: 20,
    });
  });
});

describe("Discover listing privacy and pagination", () => {
  it("keeps personal listings and source attribution out of public list, detail, and sitemap queries", async () => {
    const { service, row, queries } = fakeListings();
    await service.list({ page: 1, limit: 12 });
    await service.bySlug(row.slug);
    await service.sitemap();
    for (const query of queries) {
      expect(query.args).toMatchObject({ where: { isPublic: true } });
      if (
        query.operation === "findFirst" ||
        (query.operation === "findMany" && (query.args.select as { title?: boolean }).title)
      ) {
        expect(query.args).toMatchObject({
          select: {
            sources: { where: { isPublic: true } },
            _count: { select: { sources: { where: { isPublic: true } } } },
          },
        });
      }
    }
  });
  it("scopes private listing rows, indexed counts and source links to the current account", async () => {
    const { service, row, queries } = fakeListings();
    await service.listForUser("alice", { page: 1, limit: 12 });
    await service.bySlugForUser("alice", row.slug);
    for (const query of queries) {
      expect(query.args).toMatchObject({
        where: { OR: [{ isPublic: true }, { personalDiscoveries: { some: { userId: "alice" } } }] },
      });
      if (query.operation !== "count")
        expect(query.args).toMatchObject({
          select: {
            sources: {
              where: {
                OR: [
                  { isPublic: true },
                  { listing: { personalDiscoveries: { some: { userId: "alice" } } } },
                ],
              },
            },
          },
        });
    }
  });
  it("only adds the requesting user's saved state to the authenticated list", async () => {
    const { service, row } = fakeListings();
    await service.setSaved("alice", row.slug, true);
    expect((await service.listForUser("alice", { page: 1, limit: 25 })).items[0]?.isSaved).toBe(
      true,
    );
    const bob = await service.listForUser("bob", { page: 1, limit: 25 });
    expect(bob.items[0]?.isSaved).toBe(false);
    expect(bob.items[0]).not.toHaveProperty("savedBy");
    expect(discoverJobListingPageSchema.safeParse(bob).success).toBe(true);
    const publicPage = await service.list({ page: 1, limit: 25 });
    expect(publicPage.items[0]).not.toHaveProperty("isSaved");
    expect(publicPage.items[0]).not.toHaveProperty("savedBy");
    expect(jobListingPageSchema.parse(bob).items[0]).not.toHaveProperty("isSaved");
  });
  it("applies filters to the database count and selected page before pagination", async () => {
    const { service, queries } = fakeListings();
    const page = await service.list({
      page: 3,
      limit: 10,
      titles: ["Engineer"],
      levels: ["entry"],
      workModes: ["remote"],
      salaryMin: 70000,
      salaryCurrency: "CAD",
      salaryPeriod: "year",
    });
    const find = queries.find((query) => query.operation === "findMany")?.args;
    const count = queries.find((query) => query.operation === "count")?.args;
    expect(find).toMatchObject({
      skip: 20,
      take: 10,
      where: {
        status: "published",
        AND: [
          { OR: [{ title: { contains: "Engineer", mode: "insensitive" } }] },
          { level: { in: ["entry"] } },
          { workMode: { in: ["remote"] } },
          { salaryCurrency: "CAD", salaryPeriod: "year", salaryMax: { gte: 70000 } },
        ],
      },
    });
    expect(find?.where).toEqual(count?.where);
    expect(page.pagination).toEqual({ page: 3, limit: 10, total: 81, totalPages: 9 });
  });
});
