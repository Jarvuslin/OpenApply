import type { Prisma } from "@/generated/prisma/client";
import {
  linkListingApplications,
  listingApplicationData,
  listingApplicationIdentity,
} from "./listing-applications";
import { describe, expect, it } from "bun:test";

const posting = {
  title: "Engineer",
  company: "Example",
  location: "Toronto",
  url: "https://www.example.com/jobs/1/?utm_source=mail&ref=board",
};

describe("applied listing identity", () => {
  it("folds tracking aliases while retaining posting identifiers", () => {
    expect(listingApplicationIdentity(posting).listingUrl).toBe("https://example.com/jobs/1");
    expect(
      listingApplicationIdentity({ ...posting, url: "https://example.com/jobs?id=2&ref=mail" })
        .listingUrl,
    ).toBe("https://example.com/jobs?id=2");
  });
  it("uses a source match ahead of changed title/location metadata", async () => {
    let dedupeReads = 0;
    const db = {
      jobListing: {
        findFirst: async () => ({ id: "source-listing" }),
        findUnique: async () => {
          dedupeReads++;
          return { id: "different-listing" };
        },
      },
    } as unknown as Pick<Prisma.TransactionClient, "jobListing">;
    expect((await listingApplicationData(db, posting)).listingId).toBe("source-listing");
    expect(dedupeReads).toBe(0);
  });
  it("links the same exact normalized posting across different sources without fuzzy seniority matching", async () => {
    const identities: unknown[] = [];
    const db = {
      jobListing: {
        findFirst: async () => null,
        findUnique: async ({ where }: { where: unknown }) => {
          identities.push(where);
          return { id: "same-posting" };
        },
      },
    } as unknown as Pick<Prisma.TransactionClient, "jobListing">;
    expect((await listingApplicationData(db, posting)).listingId).toBe("same-posting");
    expect(identities).toEqual([{ dedupeKey: listingApplicationIdentity(posting).listingKey }]);
    expect(
      listingApplicationIdentity({ ...posting, title: "Senior Engineer" }).listingKey,
    ).not.toBe(listingApplicationIdentity(posting).listingKey);
  });
  it("only links unassociated history when listings arrive after applications", async () => {
    let update: unknown;
    const db = {
      application: {
        updateMany: async (args: unknown) => {
          update = args;
          return { count: 1 };
        },
      },
    } as unknown as Pick<Prisma.TransactionClient, "application">;
    await linkListingApplications(db, "listing", "key", [posting.url, null]);
    expect(update).toEqual({
      where: {
        listingId: null,
        OR: [{ listingKey: "key" }, { listingUrl: { in: ["https://example.com/jobs/1"] } }],
      },
      data: { listingId: "listing" },
    });
  });
});
