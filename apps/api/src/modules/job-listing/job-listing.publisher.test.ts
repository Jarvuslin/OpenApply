import type { PrismaClient } from "@/generated/prisma/client";
import { CompanyLogoService } from "./company-logo.service";
import { JobListingPublisher } from "./job-listing.publisher";
import type { ListingSourceJob } from "./listing-draft";
import { describe, expect, it } from "bun:test";

class NoLogo extends CompanyLogoService {
  override async resolve(): Promise<string | null> {
    return null;
  }
}
const noLogo = new NoLogo();

const job = (url: string): ListingSourceJob => ({
  title: "Staff Engineer",
  company: "Acme",
  url,
  location: "Austin, TX",
  digest: JSON.stringify({ skills: ["Go"] }),
});

interface FakeOptions {
  /** Throw a unique violation on the first create, as a racing agent would cause. */
  raceOnFirstCreate?: boolean;
  /** Resolves each call only when the returned trigger is fired, so overlap is observable. */
  gate?: { hold: true };
  /** Report the url as already known, so publish takes the enrich path instead of creating. */
  seenUrl?: boolean;
  /** The known listing's current posting date. */
  seenPostedAt?: Date | null;
  /** Listings the match rules find for an unseen posting. */
  candidates?: { id: string; sources: { boardKey: string | null; externalId: string | null }[] }[];
}

/** Stand-in for Prisma: records calls and can simulate the concurrent-insert race. */
function fakePrisma(options: FakeOptions = {}) {
  const calls: string[] = [];
  const updates: Record<string, unknown>[] = [];
  const pending: (() => void)[] = [];
  let creates = 0;
  let concurrent = 0;
  let peak = 0;

  const settle = async <T>(value: T): Promise<T> => {
    concurrent++;
    peak = Math.max(peak, concurrent);
    if (options.gate) {
      await new Promise<void>((resolve) => pending.push(resolve));
    }
    concurrent--;
    return value;
  };

  const prisma = {
    application: { updateMany: async () => ({ count: 0 }) },
    jobListingSource: {
      findFirst: async () => {
        calls.push("source.findFirst");
        return settle(
          options.seenUrl
            ? {
                id: "s1",
                listingId: "l1",
                rank: 0,
                listing: { isPublic: true, postedAt: options.seenPostedAt ?? null, sourceRank: 0 },
              }
            : null,
        );
      },
      update: async () => settle(undefined),
    },
    jobListing: {
      findMany: async () => {
        calls.push("listing.findMany");
        return settle(
          (options.candidates ?? []).map((candidate) => ({
            isPublic: true,
            postedAt: null,
            sourceRank: 0,
            companyId: "c1",
            descriptionExcerpt: null,
            ...candidate,
          })),
        );
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        calls.push("listing.update");
        updates.push(data);
        return settle({ id: "l1" });
      },
      create: async () => {
        calls.push("listing.create");
        creates++;
        if (options.raceOnFirstCreate && creates === 1) {
          concurrent--;
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        }
        return settle({ id: "l1" });
      },
    },
  } as unknown as PrismaClient;

  return {
    prisma,
    calls,
    updates,
    flush: () => {
      for (const resolve of pending.splice(0)) {
        resolve();
      }
    },
    peak: () => peak,
  };
}

describe("publish", () => {
  it("skips a job the quality gate rejects, without touching the database", async () => {
    const fake = fakePrisma();
    const svc = new JobListingPublisher(fake.prisma, noLogo);

    expect(await svc.publish({ ...job("https://x.com/1"), digest: null })).toBe("skipped");
    expect(fake.calls).toEqual([]);
  });

  it("creates a listing for an unseen posting", async () => {
    const fake = fakePrisma();
    const svc = new JobListingPublisher(fake.prisma, noLogo);

    expect(await svc.publish(job("https://x.com/1"))).toBe("created");
    expect(fake.calls).toContain("listing.create");
  });

  // The race the removed $transaction never actually prevented: at READ COMMITTED two agents can
  // both miss the lookup and both insert. The unique constraint is what makes them converge.
  it("retries once when another agent wins the insert race, and converges", async () => {
    const fake = fakePrisma({ raceOnFirstCreate: true });
    const svc = new JobListingPublisher(fake.prisma, noLogo);

    // Second pass re-reads; the fake still reports "not found", so it re-creates rather than throw.
    expect(await svc.publish(job("https://x.com/1"))).toBe("created");
    expect(fake.calls.filter((c) => c === "listing.create")).toHaveLength(2);
  });

  it("gives up after one retry rather than looping on a persistent conflict", async () => {
    const fake = fakePrisma();
    const always = {
      ...fake.prisma,
      jobListingSource: { findFirst: async () => null },
      jobListing: {
        findMany: async () => [],
        create: async () => {
          throw Object.assign(new Error("conflict"), { code: "P2002" });
        },
      },
    } as unknown as PrismaClient;

    expect(
      new JobListingPublisher(always, noLogo).publish(job("https://x.com/1")),
    ).rejects.toThrow();
  });
});

describe("matching", () => {
  const ats = (externalId: string): ListingSourceJob => ({
    ...job(`https://boards.greenhouse.io/acme/jobs/${externalId}`),
    applyUrl: "https://boards.greenhouse.io/acme/jobs/shared",
    companyId: "c1",
    boardKey: "greenhouse/acme",
    externalId,
  });

  it("joins a listing found by apply link", async () => {
    const fake = fakePrisma({
      candidates: [{ id: "l2", sources: [{ boardKey: "simplify", externalId: null }] }],
    });
    expect(await new JobListingPublisher(fake.prisma, noLogo).publish(ats("1"))).toBe("merged");
  });

  it("never joins a listing holding another id from the same board", async () => {
    const fake = fakePrisma({
      candidates: [{ id: "l2", sources: [{ boardKey: "greenhouse/acme", externalId: "2" }] }],
    });
    expect(await new JobListingPublisher(fake.prisma, noLogo).publish(ats("1"))).toBe("created");
  });
});

describe("enrich", () => {
  const withDigest = (extra: Record<string, unknown>): ListingSourceJob => ({
    ...job("https://x.com/1"),
    digest: JSON.stringify({ skills: ["Go"], ...extra }),
  });

  it("writes the digest fields when the scrape has them", async () => {
    const fake = fakePrisma({ seenUrl: true });
    await new JobListingPublisher(fake.prisma, noLogo).publish(
      withDigest({ requirements: ["Go"], responsibilities: ["Ship"], yearsExperience: 4 }),
    );

    expect(fake.updates[0]).toMatchObject({
      requirements: ["Go"],
      responsibilities: ["Ship"],
      yearsExperience: 4,
    });
  });

  it("keeps the earliest posting date when sources date the same job differently", async () => {
    const september = new Date("2026-09-03T00:00:00Z");
    const october = new Date("2026-10-01T00:00:00Z");
    const later = fakePrisma({ seenUrl: true, seenPostedAt: september });
    await new JobListingPublisher(later.prisma, noLogo).publish({
      ...withDigest({}),
      postedAt: october,
    });
    expect(later.updates[0]).not.toHaveProperty("postedAt");

    const earlier = fakePrisma({ seenUrl: true, seenPostedAt: october });
    await new JobListingPublisher(earlier.prisma, noLogo).publish({
      ...withDigest({}),
      postedAt: september,
    });
    expect(earlier.updates[0]).toMatchObject({ postedAt: september, listedAt: september });

    const undated = fakePrisma({ seenUrl: true });
    await new JobListingPublisher(undated.prisma, noLogo).publish({
      ...withDigest({}),
      postedAt: october,
    });
    expect(undated.updates[0]).toMatchObject({ postedAt: october });
  });

  it("leaves the digest fields untouched when a thinner scrape omits them", async () => {
    const fake = fakePrisma({ seenUrl: true });
    await new JobListingPublisher(fake.prisma, noLogo).publish(withDigest({}));

    const data = fake.updates[0] ?? {};
    expect(data).not.toHaveProperty("requirements");
    expect(data).not.toHaveProperty("responsibilities");
    expect(data).not.toHaveProperty("yearsExperience");
    expect(data).not.toHaveProperty("companyLogoUrl");
  });

  it("persists a discovered logo without failing publication when retrieval breaks", async () => {
    const fake = fakePrisma({ seenUrl: true });
    class Logo extends CompanyLogoService {
      override async resolve() {
        return "https://acme.com/logo.svg";
      }
    }
    await new JobListingPublisher(fake.prisma, new Logo()).publish(withDigest({}));
    expect(fake.updates[0]?.companyLogoUrl).toBe("https://acme.com/logo.svg");
    class Broken extends CompanyLogoService {
      override async resolve(): Promise<string | null> {
        throw new Error("Logo unavailable");
      }
    }
    expect(await new JobListingPublisher(fake.prisma, new Broken()).publish(withDigest({}))).toBe(
      "refreshed",
    );
    expect(fake.updates[1]).not.toHaveProperty("companyLogoUrl");
  });
});

describe("concurrency ceiling", () => {
  it("never runs more than 4 publishes at once, and queues the rest", async () => {
    const fake = fakePrisma({ gate: { hold: true } });
    const svc = new JobListingPublisher(fake.prisma, noLogo);

    // 12 concurrent publishes against a gate that holds every query open.
    const all = Array.from({ length: 12 }, (_, i) => svc.publish(job(`https://x.com/${i}`)));

    // Let the held queries drain in waves until everything completes.
    for (let i = 0; i < 20; i++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      fake.flush();
    }
    await Promise.all(all);

    // The gate counts queries in flight; with a ceiling of 4 publishes it can never exceed 4.
    expect(fake.peak()).toBeLessThanOrEqual(4);
  });
});
