import type { AgendaResponse } from "@openapply/contracts/pilot";
import { prismaFixture } from "@/common/testing/prisma-fakes";
import type { AgendaService } from "@/modules/pilot/agenda/agenda.service";
import { WorkQueueSchedulerService } from "./work-queue.scheduler";

export const schedulerUserId = "428b5804-f621-4c87-92f3-fa7b8a59a001";

export function schedulerFixture(items: AgendaResponse["items"]) {
  const f = prismaFixture();
  const agenda: AgendaResponse = {
    version: crypto.randomUUID(),
    generatedAt: new Date(),
    expiresAt: new Date(Date.now() + 60000),
    items,
    counts: { openQuestions: 0, approvedJobs: 0, appliedToday: 0 },
    budget: {
      dailyApplyCap: 5,
      appliedToday: 0,
      capReached: false,
      resetsAt: new Date(Date.now() + 86400000),
    },
    emptyReason: null,
    sleepSeconds: 30,
    nextWakeAt: new Date(Date.now() + 30000),
  };
  f.pilotStates.push({
    userId: schedulerUserId,
    running: true,
    agendaVersion: agenda.version,
    lastCycleAt: null,
    cycleCount: 0,
  });
  let refreshes = 0;
  const controls = { onRefresh: () => {} };
  const provider = {
    refresh: async () => {
      refreshes++;
      controls.onRefresh();
      return agenda;
    },
  } as unknown as AgendaService;
  const scheduler = new WorkQueueSchedulerService(f.db, provider);
  return {
    ...f,
    agenda,
    controls,
    scheduler,
    refreshes: () => refreshes,
    nextCycle: () => {
      f.pilotStates[0].lastCycleAt = null;
    },
  };
}
