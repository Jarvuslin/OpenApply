import "reflect-metadata";
import type { PrismaClient } from "@/generated/prisma/client";
import { DiscoverySearchService } from "./discovery-search.service";
import type { JobSourcesService } from "./job-sources.service";
import { expect, it, spyOn } from "bun:test";

interface State {
  key: string;
  nextCursor: string | null;
  pages: number;
  budgetStartedAt: Date;
  lastBatchAt: Date | null;
  lastResult: unknown;
  exhausted: boolean;
  leaseToken: string | null;
  leaseUntil: Date | null;
}

function fixture(options: { enabled?: boolean; fail?: boolean; nextCursor?: string | null } = {}) {
  const rows = new Map<string, State>();
  const cursors: (string | null)[] = [];
  const prisma = {
    jobSourceConnection: {
      findUnique: async () => (options.enabled === false ? null : { enabled: true }),
    },
    jobSourceSearch: {
      createMany: async ({ data }: { data: { key: string }[] }) => {
        for (const row of data)
          if (!rows.has(row.key))
            rows.set(row.key, {
              ...row,
              nextCursor: null,
              pages: 0,
              budgetStartedAt: new Date(),
              lastBatchAt: null,
              lastResult: null,
              exhausted: false,
              leaseToken: null,
              leaseUntil: null,
            });
        return { count: 1 };
      },
      findUniqueOrThrow: async ({ where }: { where: { key: string } }) => ({
        ...rows.get(where.key)!,
      }),
      updateMany: async ({
        where,
        data,
      }: {
        where: {
          key: string;
          budgetStartedAt?: { lte: Date };
          leaseToken?: string;
          pages?: { lt: number };
          AND?: unknown[];
        };
        data: Partial<Omit<State, "pages">> & { pages?: number | { increment: number } };
      }) => {
        const state = rows.get(where.key)!;
        if (where.budgetStartedAt && state.budgetStartedAt > where.budgetStartedAt.lte)
          return { count: 0 };
        if (where.leaseToken && state.leaseToken !== where.leaseToken) return { count: 0 };
        if (
          where.AND &&
          ((state.leaseUntil && state.leaseUntil > new Date()) ||
            (state.lastBatchAt && state.lastBatchAt.getTime() > Date.now() - 60_000) ||
            state.exhausted ||
            state.pages >= (where.pages?.lt ?? 10))
        )
          return { count: 0 };
        const { pages, ...fields } = data;
        Object.assign(state, fields);
        if (typeof pages === "number") state.pages = pages;
        else if (pages) state.pages += pages.increment;
        return { count: 1 };
      },
    },
  } as unknown as PrismaClient;
  const sources = {
    discoverPage: async (_userId: string, _input: unknown, cursor: string | null) => {
      cursors.push(cursor);
      await Promise.resolve();
      if (options.fail) throw new Error("source unavailable");
      return {
        imported: 10,
        fetched: 10,
        nextCursor:
          options.nextCursor === undefined ? `cursor-${cursors.length}` : options.nextCursor,
      };
    },
  } as unknown as JobSourcesService;
  return { rows, cursors, service: new DiscoverySearchService(prisma, sources) };
}

const input = {
  provider: "serpapi" as const,
  query: "Software engineer",
  location: "Canada",
  limit: 20,
};

it("requires an enabled provider before creating any paid search state", async () => {
  const state = fixture({ enabled: false });
  await expect(state.service.search("alice", input)).rejects.toThrow("Settings → Connections");
  expect(state.rows.size).toBe(0);
  expect(state.cursors).toEqual([]);
});

it("shares durable leases across concurrent clicks and advances using the actual cursor after cooldown", async () => {
  const state = fixture();
  const results = await Promise.all([
    state.service.search("alice", input),
    state.service.search("alice", input),
  ]);
  expect(state.cursors).toEqual([null]);
  expect(results.filter((result) => !result.cached)).toHaveLength(1);
  expect((await state.service.search("alice", input)).cached).toBe(true);
  expect(state.cursors).toHaveLength(1);
  const row = [...state.rows.values()][0]!;
  row.lastBatchAt = new Date(Date.now() - 60_001);
  expect((await state.service.search("alice", input)).hasMore).toBe(true);
  expect(state.cursors).toEqual([null, "cursor-1"]);
  expect(row.pages).toBe(2);
  expect(row.leaseToken).toBeNull();
});

it("stops on exhausted pages and caps each user's query to 10 attempts per day", async () => {
  const exhausted = fixture({ nextCursor: null });
  expect((await exhausted.service.search("alice", input)).hasMore).toBe(false);
  expect((await exhausted.service.search("alice", input)).cached).toBe(true);
  expect(exhausted.cursors).toHaveLength(1);
  const state = fixture();
  await state.service.search("alice", input);
  const row = [...state.rows.values()][0]!;
  row.pages = 10;
  row.lastBatchAt = new Date(Date.now() - 60_001);
  expect((await state.service.search("alice", input)).message).toContain("10 batches");
  expect(state.cursors).toHaveLength(1);
  await state.service.search("bob", input);
  expect(state.rows.size).toBe(2);
  row.budgetStartedAt = new Date(Date.now() - 86_400_001);
  expect((await state.service.search("alice", input)).cached).toBe(false);
  expect(state.cursors.at(-1)).toBeNull();
});

it("releases a failed source lease while retaining the attempt budget and cooldown", async () => {
  const state = fixture({ fail: true });
  await expect(state.service.search("alice", input)).rejects.toThrow("source unavailable");
  const row = [...state.rows.values()][0]!;
  expect(row.pages).toBe(1);
  expect(row.leaseToken).toBeNull();
  expect(row.leaseUntil).toBeNull();
  expect((await state.service.search("alice", input)).cached).toBe(true);
  expect(state.cursors).toHaveLength(1);
});

it("keeps HiringCafe previews private, short-lived and coalesced without any database writes", async () => {
  const state = fixture({ enabled: false });
  let calls = 0;
  const fetch = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: string | URL | Request) => {
        // The robots.txt check is a separate request; only searches count here.
        if (String(input).endsWith("/robots.txt")) return new Response("", { status: 404 });
        calls++;
        return Response.json({ result: { structuredContent: { jobs: [], total_matches: 0 } } });
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  try {
    const result = await state.service.search("alice", { ...input, provider: "hiringcafe" });
    expect(result).toMatchObject({ imported: 0, fetched: 0, hasMore: false, jobs: [] });
    expect((await state.service.search("alice", { ...input, provider: "hiringcafe" })).cached).toBe(
      true,
    );
    expect(state.rows.size).toBe(0);
    expect(state.cursors).toEqual([]);
    expect(calls).toBe(1);
  } finally {
    fetch.mockRestore();
  }
});
