import "reflect-metadata";
import type { PrismaClient } from "@/generated/prisma/client";
import type { CatalogRefreshService } from "./catalog-refresh.service";
import { DiscoveryFeedService } from "./discovery-feed.service";
import { expect, it } from "bun:test";

function fixture() {
  let refreshes = 0;
  const now = new Date();
  const prisma = {
    jobFeedRefresh: {
      findMany: async () => [
        {
          key: "ashby/openai",
          lastSuccessAt: now,
          nextRefreshAt: now,
          leaseUntil: null,
          lastError: null,
        },
        {
          key: "public/remoteok",
          lastSuccessAt: now,
          nextRefreshAt: now,
          leaseUntil: null,
          lastError: "temporary error",
        },
        {
          key: "public/weworkremotely",
          lastSuccessAt: null,
          nextRefreshAt: now,
          leaseUntil: new Date(Date.now() + 1000),
          lastError: null,
        },
      ],
    },
    jobSourceConnection: {
      findMany: async () => [
        { provider: "apify", config: { linkedinActor: { id: "example/jobs" } } },
      ],
    },
    linkedinDiscoverySettings: { findUnique: async () => null },
    linkedinDiscoveryRun: { findFirst: async () => null },
  } as unknown as PrismaClient;
  const refresh = {
    refreshDue: async () => {
      refreshes++;
      return {};
    },
  } as unknown as CatalogRefreshService;
  return { service: new DiscoveryFeedService(prisma, refresh), refreshes: () => refreshes };
}

it("reports per-source truth without treating one enabled actor as every connected board", async () => {
  const { service } = fixture();
  const result = await service.coverage("alice");
  const statuses = Object.fromEntries(result.sources.map((source) => [source.id, source.status]));
  expect(statuses).toMatchObject({
    ashby: "connected",
    greenhouse: "pending",
    remoteok: "error",
    weworkremotely: "pending",
    linkedin: "connected",
    "linkedin-jobspy": "needs_setup",
    indeed: "needs_setup",
    glassdoor: "needs_setup",
    google_jobs: "needs_setup",
  });
  expect(result.sources.find((source) => source.id === "hiringcafe")?.details).toContain(
    "Private on-demand",
  );
  expect(result.refreshing).toBe(true);
  expect(result.lastUpdatedAt).toBeInstanceOf(Date);
});

it("coalesces repeated refresh clicks and honors disabled scheduled collection", async () => {
  const { service, refreshes } = fixture();
  expect((await service.requestRefresh("alice", false)).scheduled).toBe(false);
  expect((await service.requestRefresh("alice", true)).scheduled).toBe(true);
  expect((await service.requestRefresh("bob", true)).scheduled).toBe(false);
  expect(refreshes()).toBe(1);
});
