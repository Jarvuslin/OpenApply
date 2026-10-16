import type { Prisma } from "@/generated/prisma/client";
import { listRulesApply } from "./discovery-guard";
import { describe, expect, test } from "bun:test";

type Row = { userId: string; jobId: string; kind: string; source: string };
type Filter = string | { in: string[] };

function db(rows: Row[]) {
  const matches = (value: string, filter: Filter) =>
    typeof filter === "string" ? value === filter : filter.in.includes(value);
  return {
    workItem: {
      count: async ({ where }: { where: Record<keyof Row, Filter> }) =>
        rows.filter((row) =>
          (Object.keys(where) as (keyof Row)[]).every((key) => matches(row[key], where[key])),
        ).length,
    },
  } as unknown as Prisma.TransactionClient;
}

describe("search-list rules", () => {
  test("apply to jobs the search picked", async () => {
    const rows = [{ userId: "u", jobId: "j", kind: "application", source: "discovery" }];
    expect(await listRulesApply(db(rows), "u", "j")).toBe(true);
  });

  test("are skipped for a job the person queued from the queue or the Jobs page", async () => {
    for (const source of ["user", "mvp"]) {
      const rows = [{ userId: "u", jobId: "j", kind: "application", source }];
      expect(await listRulesApply(db(rows), "u", "j")).toBe(false);
    }
  });
});
