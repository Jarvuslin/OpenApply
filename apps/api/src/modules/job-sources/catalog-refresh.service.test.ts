import "reflect-metadata";
import type { PrismaClient } from "@/generated/prisma/client";
import { CatalogRefreshService } from "./catalog-refresh.service";
import type { JobSourcesService } from "./job-sources.service";
import { expect, it } from "bun:test";

interface Row {
  key: string;
  nextRefreshAt: Date;
  leaseToken: string | null;
  leaseUntil: Date | null;
  lastSuccessAt?: Date;
  lastError?: string | null;
}

interface Discovered {
  key: string;
  provider: string;
  slug: string;
  company: string;
  lastSeenAt?: Date;
}

function fixture(
  fail = false,
  keys = ["ashby/openai", "ashby/notion"],
  discovered: Discovered[] = [],
) {
  const rows: Row[] = keys.map((key) => ({
    key,
    nextRefreshAt: new Date(0),
    leaseToken: null,
    leaseUntil: null,
  }));
  const calls: string[] = [];
  const created: string[] = [];
  const probes: { key: string; checkedAt: Date; boardKey: string | null }[] = [];
  const prisma = {
    jobBoardProbe: {
      findMany: async () => probes,
      upsert: async ({ create }: { create: (typeof probes)[number] }) => {
        probes.push(create);
        return create;
      },
    },
    discoveredJobBoard: {
      findMany: async () => discovered,
      upsert: async ({ create }: { create: Discovered }) => {
        discovered.push(create);
        return create;
      },
    },
    jobFeedRefresh: {
      createMany: async ({ data }: { data: { key: string }[] }) => {
        created.push(...data.map((row) => row.key));
        return { count: data.length };
      },
      findMany: async () =>
        rows
          .filter(
            (row) =>
              row.nextRefreshAt <= new Date() && (!row.leaseUntil || row.leaseUntil <= new Date()),
          )
          .map(({ key }) => ({ key })),
      updateMany: async ({
        where,
        data,
      }: {
        where: { key: string; leaseToken?: string; nextRefreshAt?: { lte: Date } };
        data: Partial<Row>;
      }) => {
        const row = rows.find((item) => item.key === where.key);
        if (!row || (where.leaseToken && row.leaseToken !== where.leaseToken)) return { count: 0 };
        if (
          where.nextRefreshAt &&
          (row.nextRefreshAt > where.nextRefreshAt.lte ||
            (row.leaseUntil && row.leaseUntil > where.nextRefreshAt.lte))
        )
          return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
  } as unknown as PrismaClient;
  const sources = {
    publicFeed: async (id: string) => {
      calls.push(id);
      return { fetched: 15, imported: 12, truncated: false };
    },
    publicBoard: async (_provider: string, slug: string) => {
      calls.push(slug);
      await Promise.resolve();
      if (fail && slug === "openai") throw new Error("Temporary feed outage");
      return { fetched: 12, imported: 10, truncated: false };
    },
  } as unknown as JobSourcesService;
  return {
    rows,
    calls,
    created,
    discovered,
    probes,
    service: new CatalogRefreshService(prisma, sources),
  };
}

it("shares feed leases across overlapping refreshes and avoids fetching on every request", async () => {
  const state = fixture();
  const results = await Promise.all([state.service.refreshDue(), state.service.refreshDue()]);
  expect(state.calls.sort()).toEqual(["notion", "openai"]);
  expect(results.reduce((sum, result) => sum + result.refreshed, 0)).toBe(2);
  expect(state.rows.every((row) => row.leaseToken === null && row.leaseUntil === null)).toBe(true);
  await state.service.refreshDue();
  expect(state.calls).toHaveLength(2);
});

it("continues other feeds after a failure and schedules a bounded retry", async () => {
  const state = fixture(true);
  const now = Date.now();
  const result = await state.service.refreshDue();
  expect(result).toMatchObject({ refreshed: 1, failed: 1, imported: 10 });
  const failed = state.rows.find((row) => row.key === "ashby/openai")!;
  expect(failed.lastError).toBe("Temporary feed outage");
  expect(failed.leaseToken).toBeNull();
  expect(failed.nextRefreshAt.getTime()).toBeGreaterThanOrEqual(now + 60 * 60 * 1000);
  const successful = state.rows.find((row) => row.key === "ashby/notion")!;
  expect(successful.lastSuccessAt).toBeInstanceOf(Date);
  expect(successful.nextRefreshAt.getTime()).toBeGreaterThanOrEqual(now + 10 * 60 * 1000);
});

it("dispatches public feeds separately and keeps them on a half-hour cadence", async () => {
  const state = fixture(false, ["public/remoteok", "public/weworkremotely"]);
  const now = Date.now();
  expect(await state.service.refreshDue()).toMatchObject({ refreshed: 2, imported: 24 });
  expect(state.calls.sort()).toEqual(["remoteok", "weworkremotely"]);
  expect(state.rows.every((row) => row.nextRefreshAt.getTime() >= now + 30 * 60 * 1000)).toBe(true);
});

it("refreshes boards found in Simplify on a slower three-hour cadence", async () => {
  const state = fixture(
    false,
    ["lever/tinyco"],
    [{ key: "lever/tinyco", provider: "lever", slug: "tinyco", company: "Tiny Co" }],
  );
  const now = Date.now();
  expect(await state.service.refreshDue()).toMatchObject({ refreshed: 1, imported: 10 });
  expect(state.calls).toEqual(["tinyco"]);
  expect(state.rows[0]!.nextRefreshAt.getTime()).toBeGreaterThanOrEqual(now + 3 * 60 * 60 * 1000);
});

it("records new Simplify boards for refresh and skips ones the catalog already covers", async () => {
  const state = fixture(false, []);
  const found = await state.service.discoverBoards(async () => [
    {
      company_name: "Tiny Co",
      title: "Software Engineer",
      url: "https://jobs.lever.co/tinyco/1",
      locations: [],
      active: true,
      is_visible: true,
      date_posted: 1,
    },
    {
      company_name: "OpenAI",
      title: "Engineer",
      url: "https://jobs.ashbyhq.com/OpenAI/2",
      locations: [],
      active: true,
      is_visible: true,
      date_posted: 1,
    },
  ]);
  expect(found).toBe(1);
  expect(state.discovered.map((board) => board.key)).toEqual(["lever/tinyco"]);
  expect(state.created).toEqual(["lever/tinyco"]);
});

it("probes YC companies for a board that names them and remembers every result", async () => {
  const state = fixture(false, []);
  const requested: string[] = [];
  const result = await state.service.discoverYcBoards(async (url) => {
    requested.push(url);
    if (url.includes("yc-oss"))
      return [
        { name: "Tiny Co", slug: "tinyco", website: "https://tiny.co" },
        { name: "Nobody", slug: "nobody", website: null },
      ];
    if (url.includes("job-board/tinyco"))
      return {
        jobs: [
          {
            id: "1",
            title: "Engineer",
            jobUrl: "https://jobs.ashbyhq.com/tinyco/1",
            applyUrl: "https://jobs.ashbyhq.com/tinyco/1/application",
            descriptionPlain: "Join Tiny Co at tiny.co",
            location: "Remote",
            isListed: true,
            publishedAt: "2026-10-01T00:00:00.000Z",
          },
        ],
      };
    throw new Error("HTTP 404");
  });
  expect(result).toEqual({ checked: 2, found: 1 });
  expect(state.discovered.map((board) => board.key)).toEqual(["ashby/tinyco"]);
  expect(state.probes.map((probe) => [probe.key, probe.boardKey])).toEqual([
    ["yc/tinyco", "ashby/tinyco"],
    ["yc/nobody", null],
  ]);
  // Nobody was looked for on every provider before giving up.
  expect(requested.filter((url) => url.includes("nobody")).length).toBe(4);
});
