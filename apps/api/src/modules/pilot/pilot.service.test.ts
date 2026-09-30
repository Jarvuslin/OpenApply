import {
  pilotInstructionsChangeSchema,
  pilotInstructionsConfigSchema,
} from "@jobpilot/contracts/pilot";
import type { PrismaClient } from "@/generated/prisma/client";
import { PilotService } from "./pilot.service";
import { describe, expect, it } from "bun:test";

const stateRow = (over: Record<string, unknown>) => ({
  userId: "p1",
  running: false,
  instructionsGoals: "",
  instructionsConfig: {},
  instructionsUpdatedAt: new Date(),
  lastCycleAt: null,
  cycleCount: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

function stateService(savedGoals: string) {
  const rec = {
    searchResets: 0,
    searchDeletes: 0,
    bootstrapClaimDeletes: 0,
    campaignsCompleted: 0,
    jobsDropped: 0,
  };
  const count = (key: keyof typeof rec) => async () => {
    rec[key]++;
    return { count: 1 };
  };
  const db = {
    pilotState: {
      findUnique: async () => ({ instructionsGoals: savedGoals }),
      upsert: async (a: { update: Record<string, unknown> }) =>
        stateRow({ instructionsGoals: savedGoals, ...a.update }),
    },
    pilotSearch: { updateMany: count("searchResets"), deleteMany: count("searchDeletes") },
    pilotClaim: { deleteMany: count("bootstrapClaimDeletes") },
    campaign: { updateMany: count("campaignsCompleted") },
    job: { updateMany: count("jobsDropped") },
    application: { count: async () => 0 },
    networkingMessage: { count: async () => 0 },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };
  return { svc: new PilotService(db as unknown as PrismaClient), rec };
}

describe("PilotService.updateInstructions", () => {
  const body = (goals: string, onChange = {}) => ({
    goals,
    config: pilotInstructionsConfigSchema.parse({}),
    onChange: pilotInstructionsChangeSchema.parse(onChange),
  });

  it("makes every search due when the goals change, and retires nothing unasked", async () => {
    const { svc, rec } = stateService("old goals");
    await svc.updateInstructions("p1", body("new goals"));
    expect(rec).toEqual({
      searchResets: 1,
      searchDeletes: 0,
      bootstrapClaimDeletes: 0,
      campaignsCompleted: 0,
      jobsDropped: 0,
    });
  });

  it("leaves searches alone when the goals are unchanged", async () => {
    const { svc, rec } = stateService("same goals");
    await svc.updateInstructions("p1", body("same goals"));
    expect(rec.searchResets).toBe(0);
  });

  it("clears the bootstrap damper with the searches, or the re-derive waits a day", async () => {
    const { svc, rec } = stateService("old goals");
    await svc.updateInstructions("p1", body("new goals", { rederiveSearches: true }));
    expect(rec).toMatchObject({ searchResets: 0, searchDeletes: 1, bootstrapClaimDeletes: 1 });
  });

  it("completes campaigns and drops the approved backlog when asked", async () => {
    const { svc, rec } = stateService("old goals");
    await svc.updateInstructions(
      "p1",
      body("new goals", { completeCampaigns: true, dropApprovedJobs: true }),
    );
    expect(rec).toMatchObject({ campaignsCompleted: 1, jobsDropped: 1 });
  });
});

describe("PilotService.start", () => {
  it("refuses to start without goals, but always stops", async () => {
    await expect(stateService("   ").svc.start("p1")).rejects.toMatchObject({ status: 409 });
    expect((await stateService("").svc.stop("p1")).running).toBe(false);
  });

  it("starts once goals are written", async () => {
    const state = await stateService("ship senior frontend roles").svc.start("p1");
    expect(state.running).toBe(true);
  });
});

describe("PilotService.getActivity", () => {
  const completedAt = new Date("2026-07-20T12:00:00Z");

  function activityService(
    cycleEntry: Record<string, unknown> | null,
    state: { running: boolean } | null = { running: true },
  ) {
    const noMax = { _max: { createdAt: null, updatedAt: null } };
    const db = {
      pilotClaim: { findMany: async () => [] },
      pilotJournalEntry: { aggregate: async () => noMax, findFirst: async () => cycleEntry },
      campaign: { aggregate: async () => noMax },
      job: { aggregate: async () => noMax },
      pilotState: { findUnique: async () => state },
    };
    return new PilotService(db as unknown as PrismaClient);
  }

  it("reports the newest cycle's status and sleep", async () => {
    const svc = activityService({
      cycleId: "cyc-1",
      createdAt: completedAt,
      detail: { status: "ok", sleepSeconds: 300 },
    });
    expect((await svc.getActivity("p1")).lastCycle).toEqual({
      cycleId: "cyc-1",
      completedAt,
      status: "ok",
      sleepSeconds: 300,
    });
  });

  it("still reports a stuck-recovery cycle that journaled no detail", async () => {
    const svc = activityService({ cycleId: null, createdAt: completedAt, detail: {} });
    expect((await svc.getActivity("p1")).lastCycle).toEqual({
      cycleId: null,
      completedAt,
      status: null,
      sleepSeconds: null,
    });
  });

  it("reads a profile with no cycle or state row as never run and stopped", async () => {
    const activity = await activityService(null, null).getActivity("p1");
    expect(activity).toMatchObject({ lastCycle: null, running: false, lastActivityAt: null });
    expect((await activityService(null).getActivity("p1")).running).toBe(true);
  });
});
