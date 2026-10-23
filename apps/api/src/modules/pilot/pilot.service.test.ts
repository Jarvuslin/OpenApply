import {
  pilotInstructionsChangeSchema,
  pilotInstructionsConfigSchema,
  updatePilotInstructionsSchema,
} from "@openapply/contracts/pilot";
import type { PrismaClient } from "@/generated/prisma/client";
import { SUBMISSION_NOT_STARTED } from "@/modules/campaign/jobs/submission-guard";
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

function stateService(savedGoals: string, profileMinimum = 60) {
  const jobWrites: { where: Record<string, unknown> }[] = [];
  const rec = {
    searchResets: 0,
    searchDeletes: 0,
    campaignsCompleted: 0,
    jobsDropped: 0,
  };
  const count = (key: keyof typeof rec) => async () => {
    rec[key]++;
    return { count: 1 };
  };
  const db = {
    autoApplySettings: { findUnique: async () => ({ minMatchScore: profileMinimum }) },
    $queryRaw: async () => [],
    pilotState: {
      findUnique: async () => ({ instructionsGoals: savedGoals }),
      upsert: async (a: { update: Record<string, unknown> }) =>
        stateRow({ instructionsGoals: savedGoals, ...a.update }),
    },
    pilotSearch: { updateMany: count("searchResets"), deleteMany: count("searchDeletes") },
    campaign: {
      findMany: async () => [{ campaignId: "c1", source: "auto_apply" }],
      updateMany: count("campaignsCompleted"),
    },
    job: {
      updateMany: async (input: { where: Record<string, unknown> }) => {
        jobWrites.push(input);
        return count("jobsDropped")();
      },
    },
    application: { count: async () => 0 },

    $transaction: async (ops: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) =>
      typeof ops === "function" ? ops(db) : Promise.all(ops),
  };
  return { svc: new PilotService(db as unknown as PrismaClient), rec, jobWrites };
}

describe("PilotService.updateInstructions", () => {
  const body = (goals: string, onChange = {}) => ({
    goals,
    config: pilotInstructionsConfigSchema.parse({}),
    onChange: pilotInstructionsChangeSchema.parse(onChange),
  });

  it("returns profile20 for inherited instructions and honors an explicit override", async () => {
    const { svc } = stateService("Entry software Toronto", 20);
    expect(await svc.getState("p1")).toMatchObject({
      instructionsConfig: { minScore: 20 },
      minScoreInherited: true,
    });
    for (const minimum of [undefined, 0, 60]) {
      const input = updatePilotInstructionsSchema.parse({
        goals: "Entry software Toronto",
        config: minimum === undefined ? {} : { minScore: minimum },
      });
      expect(await svc.updateInstructions("p1", input)).toMatchObject({
        instructionsConfig: { minScore: minimum ?? 20 },
        minScoreInherited: minimum === undefined,
      });
    }
  });

  it("makes every search due when the goals change, and retires nothing unasked", async () => {
    const { svc, rec } = stateService("old goals");
    await svc.updateInstructions("p1", body("new goals"));
    expect(rec).toEqual({
      searchResets: 1,
      searchDeletes: 0,
      campaignsCompleted: 0,
      jobsDropped: 0,
    });
  });

  it("leaves searches alone when the goals are unchanged", async () => {
    const { svc, rec } = stateService("same goals");
    await svc.updateInstructions("p1", body("same goals"));
    expect(rec.searchResets).toBe(0);
  });

  it("deletes the searches when asked to re-derive them", async () => {
    const { svc, rec } = stateService("old goals");
    await svc.updateInstructions("p1", body("new goals", { rederiveSearches: true }));
    expect(rec).toMatchObject({ searchResets: 0, searchDeletes: 1 });
  });

  it("completes campaigns and drops the approved backlog when asked", async () => {
    const { svc, rec, jobWrites } = stateService("old goals");
    await svc.updateInstructions(
      "p1",
      body("new goals", { completeCampaigns: true, dropApprovedJobs: true }),
    );
    expect(rec).toMatchObject({ campaignsCompleted: 1, jobsDropped: 1 });
    expect(jobWrites[0]?.where).toMatchObject({ AND: [SUBMISSION_NOT_STARTED] });
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
