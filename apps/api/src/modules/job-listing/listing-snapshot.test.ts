import "reflect-metadata";
import {
  jobListingQuerySchema,
  jobListingUpdatesQuerySchema,
} from "@openapply/contracts/job-listing";
import type { PrismaClient } from "@/generated/prisma/client";
import { JobListingService } from "./job-listing.service";
import { listingFilters } from "./listing-filters";
import { expect, it } from "bun:test";

it("fixes database pagination and relative dates to the browsing snapshot", () => {
  const indexedBefore = "2026-10-08T12:00:00.000Z";
  const query = jobListingQuerySchema.parse({ indexedBefore, postedWithinDays: 1, page: 2 });
  expect(listingFilters(query, [])).toEqual({
    AND: [
      { firstSeenAt: { lte: new Date(indexedBefore) } },
      { postedAt: { gte: new Date("2026-10-07T12:00:00.000Z") } },
    ],
  });
  expect(jobListingUpdatesQuerySchema.safeParse({}).success).toBe(false);
  expect(jobListingQuerySchema.safeParse({ indexedBefore: "yesterday" }).success).toBe(false);
});

it("counts only newer published jobs with the same filters and requesting user's activity", async () => {
  let args: unknown;
  const service = new JobListingService({
    jobListing: {
      count: async (input: unknown) => {
        args = input;
        return 4;
      },
    },
  } as unknown as PrismaClient);
  const indexedBefore = "2026-10-01T12:00:00.000Z";
  const response = await service.updates("alice", {
    page: 3,
    limit: 25,
    indexedBefore,
    countries: ["US"],
    activity: "not_applied",
  });
  expect(response).toMatchObject({ newCount: 4, asOf: expect.any(Date) });
  expect(args).toEqual({
    where: {
      AND: [
        {
          status: "published",
          OR: [{ isPublic: true }, { personalDiscoveries: { some: { userId: "alice" } } }],
          AND: [
            { countries: { hasSome: ["US"] } },
            { applications: { none: { userId: "alice" } } },
          ],
        },
        { firstSeenAt: { gt: new Date(indexedBefore), lte: response.asOf } },
      ],
    },
  });
});
