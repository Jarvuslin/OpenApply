import { makePush } from "@/common/push/push.fake";
import type { PushPayload } from "@/common/push/push.service";
import type { PrismaClient } from "@/generated/prisma/client";
import { PilotJournalService } from "./journal.service";
import { describe, expect, it } from "bun:test";

type Row = Record<string, unknown>;

function makeService(rows: Row[] = [], pageSize = 2) {
  const rec = {
    creates: [] as Row[],
    stateUpserts: [] as { update: Row }[],
    pushes: [] as { userId: string; payload: PushPayload }[],
    wheres: [] as Row[],
  };
  const db = {
    pilotJournalEntry: {
      createMany: async (a: { data: Row[] }) => {
        rec.creates.push(...a.data);
        return { count: a.data.length };
      },
      findMany: async (a: { where: Row; cursor?: { id: string } }) => {
        rec.wheres.push(a.where);
        const start = a.cursor ? rows.findIndex((row) => row.id === a.cursor?.id) + 1 : 0;
        return rows.slice(start, start + pageSize);
      },
    },
    pilotState: {
      upsert: async (a: { update: Row }) => {
        rec.stateUpserts.push(a);
        return {};
      },
    },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(db),
  };
  const svc = new PilotJournalService(db as unknown as PrismaClient, makePush(rec.pushes));
  return { svc, rec };
}

describe("PilotJournalService.appendJournal", () => {
  it("advances cycle accounting only for cycle entries", async () => {
    const { svc, rec } = makeService();
    const res = await svc.appendJournal("p1", {
      cycleId: "cycle-1",
      entries: [
        { kind: "cycle", summary: "Completed cycle 1" },
        { kind: "action", summary: "Applied to job" },
      ],
    });
    expect(res.items).toHaveLength(2);
    expect(rec.stateUpserts).toHaveLength(1);
    expect(rec.stateUpserts[0].update).toMatchObject({
      cycleCount: { increment: 1 },
      lastCycleAt: expect.any(Date),
    });

    await svc.appendJournal("p1", { entries: [{ kind: "action", summary: "did a thing" }] });
    expect(rec.stateUpserts).toHaveLength(1);
  });

  it("pushes an alert for a system entry only", async () => {
    const { svc, rec } = makeService();
    await svc.appendJournal("p1", {
      entries: [
        { kind: "action", summary: "applied to a job" },
        { kind: "system", summary: "Pilot stopped unexpectedly (orchestrator)" },
      ],
    });
    expect(rec.pushes).toEqual([
      {
        userId: "p1",
        payload: {
          title: "Pilot alert",
          body: "Pilot stopped unexpectedly (orchestrator)",
          url: "/pilot",
          tag: "pilot-system",
        },
      },
    ]);
  });
});

describe("PilotJournalService reads", () => {
  it("filters the list by kinds only when some are given", async () => {
    const { svc, rec } = makeService();
    await svc.listJournal("p1", undefined, 50, ["action", "cycle"]);
    await svc.listJournal("p1", undefined, 50, []);
    expect(rec.wheres).toEqual([
      { userId: "p1", kind: { in: ["action", "cycle"] } },
      { userId: "p1", kind: undefined },
    ]);
  });

  it("exports every entry as ordered NDJSON across batches", async () => {
    const entry = (id: string, minute: number) => ({
      id,
      userId: "p1",
      cycleId: null,
      kind: "action",
      summary: `entry ${id}`,
      detail: {},
      subjectType: null,
      subjectId: null,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, minute)),
    });
    const { svc } = makeService(["a", "b", "c", "d", "e"].map(entry));
    const res = svc.streamJournalExport("p1");
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");

    const lines = (await res.text()).trim().split("\n");
    expect(lines.map((line) => JSON.parse(line).id)).toEqual(["a", "b", "c", "d", "e"]);
  });
});
