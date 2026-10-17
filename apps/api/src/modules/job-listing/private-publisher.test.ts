import type { PrismaClient } from "@/generated/prisma/client";
import { CompanyLogoService } from "./company-logo.service";
import { canonicalizeUrl } from "./dedupe";
import { JobListingPublisher } from "./job-listing.publisher";
import type { ListingSourceJob } from "./listing-draft";
import { describe, expect, it } from "bun:test";

class NoLogo extends CompanyLogoService {
  override async resolve() {
    return null;
  }
}

type Row = Record<string, unknown>;
type Source = Row & { url: string; listingId: string; applyUrl: string | null };
type ListingData = Row & { sources?: { create: Omit<Source, "listingId"> & { url: string } } };
function database() {
  const listings = new Map<string, Row>();
  const sources = new Map<string, Source>();
  const owners = new Set<string>();
  const db = {
    application: { updateMany: async () => ({ count: 0 }) },
    personalJobListing: {
      createMany: async ({ data }: { data: Row[] }) => {
        for (const row of data) owners.add(`${row.userId}/${row.listingId}`);
        return { count: data.length };
      },
    },
    jobListingSource: {
      findUnique: async ({ where }: { where: { url: string } }) => {
        const source = sources.get(where.url);
        return source ? { ...source, listing: listings.get(source.listingId) } : null;
      },
      findFirst: async ({ where }: { where: { OR: Row[] } }) => {
        const source = [...sources.values()].find((row) =>
          where.OR.some((clause: Row) =>
            Object.entries(clause).every(([key, value]) => row[key] === value),
          ),
        );
        return source ? { ...source, listing: listings.get(source.listingId) } : null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) =>
        Object.assign(sources.get(where.id)!, data),
    },
    jobListing: {
      // The match rules: a listing holding a source with this url or apply link.
      findMany: async ({ where }: { where: { sources?: { some: { OR: Row[] } } } }) => {
        const clauses = where.sources?.some.OR ?? [];
        return [...listings.values()]
          .filter((listing) =>
            [...sources.values()].some(
              (source) =>
                source.listingId === listing.id &&
                clauses.some((clause) =>
                  Object.entries(clause).every(([key, value]) => source[key] === value),
                ),
            ),
          )
          .map((listing) => ({
            ...listing,
            sources: [...sources.values()]
              .filter((source) => source.listingId === listing.id)
              .map(({ boardKey, externalId }) => ({ boardKey, externalId })),
          }));
      },
      create: async ({ data }: { data: ListingData }) => {
        const id = `listing-${listings.size + 1}`;
        const { sources: nested, ...row } = data;
        listings.set(id, { ...row, id });
        sources.set(nested!.create.url, {
          ...nested!.create,
          id: nested!.create.url,
          listingId: id,
        } as unknown as Source);
        return { id };
      },
      update: async ({ where, data }: { where: { id: string }; data: ListingData }) => {
        const { sources: nested, ...row } = data;
        Object.assign(listings.get(where.id)!, row);
        if (nested)
          sources.set(nested.create.url, {
            ...nested.create,
            id: nested.create.url,
            listingId: where.id,
          } as unknown as Source);
        return { id: where.id };
      },
    },
  } as unknown as PrismaClient;
  return { publisher: new JobListingPublisher(db, new NoLogo()), listings, sources, owners };
}

const employer = "https://jobs.ashbyhq.com/acme/one";
const linkedin = "https://www.linkedin.com/jobs/view/123456";
const linkedinKey = canonicalizeUrl(linkedin);
const job = (url: string): ListingSourceJob => ({
  title: "Junior Software Engineer",
  company: "Acme",
  location: "Toronto, Canada",
  url,
  board: "linkedin-jobspy",
  attributionUrl: url,
  publicFeed: true,
  applyUrl: null,
});

describe("personal discovery publication", () => {
  it("keeps unresolved jobs private, unqueueable, and deduped across repeated runs and owners", async () => {
    const state = database();
    expect(await state.publisher.publishPrivate(job(linkedin), "alice")).toBe("created");
    expect(await state.publisher.publishPrivate(job(linkedin), "alice")).toBe("refreshed");
    expect(await state.publisher.publishPrivate(job(linkedin), "bob")).toBe("refreshed");
    expect(state.listings.size).toBe(1);
    expect(state.sources.get(linkedinKey)).toMatchObject({ isPublic: false, applyUrl: null });
    expect(state.listings.get("listing-1")?.isPublic).toBe(false);
    expect([...state.owners]).toEqual(["alice/listing-1", "bob/listing-1"]);
  });

  it("dedupes by verified ATS URL even when the private posting has a different location label", async () => {
    const state = database();
    await state.publisher.publish({ ...job(employer), board: "ashby", applyUrl: employer });
    expect(
      await state.publisher.publishPrivate(
        { ...job(linkedin), location: "Toronto, ON, Canada", applyUrl: employer },
        "alice",
      ),
    ).toBe("merged");
    expect(state.listings.size).toBe(1);
    expect(state.listings.get("listing-1")?.isPublic).toBe(true);
    expect(state.sources.get(employer)?.isPublic).toBe(true);
    expect(state.sources.get(linkedinKey)).toMatchObject({ isPublic: false, applyUrl: employer });
    expect([...state.owners]).toEqual(["alice/listing-1"]);
  });

  it("promotes a matching posting when later independently published by a public ATS feed", async () => {
    const state = database();
    await state.publisher.publishPrivate({ ...job(linkedin), applyUrl: employer }, "alice");
    await state.publisher.publish({ ...job(employer), board: "ashby", applyUrl: employer });
    expect(state.listings.size).toBe(1);
    expect(state.listings.get("listing-1")?.isPublic).toBe(true);
    expect(state.sources.get(linkedinKey)?.isPublic).toBe(false);
    expect(state.sources.get(employer)?.isPublic).toBe(true);
  });
  it("does not overwrite public employer metadata from a private discovery payload", async () => {
    const state = database();
    await state.publisher.publish({
      ...job(employer),
      board: "ashby",
      applyUrl: employer,
      description: "Verified employer description",
    });
    const personal = {
      ...job(linkedin),
      applyUrl: employer,
      description: "Unverified private payload",
      salary: "USD 999999 per year",
    };
    await state.publisher.publishPrivate(personal, "alice");
    await state.publisher.publishPrivate(personal, "alice");
    expect(state.listings.get("listing-1")).toMatchObject({
      descriptionExcerpt: "Verified employer description",
      salary: null,
    });
  });

  it("keeps authoritative ATS attribution when a curated collection rediscovers its URL", async () => {
    const state = database();
    await state.publisher.publish({ ...job(employer), board: "ashby", applyUrl: employer });
    await state.publisher.publish({
      ...job(employer),
      board: "simplify-new-grad",
      attributionUrl: "https://github.com/SimplifyJobs/New-Grad-Positions",
      applyUrl: employer,
    });
    expect(state.listings.size).toBe(1);
    expect(state.sources.get(employer)).toMatchObject({ board: "ashby", attributionUrl: employer });
  });
});
