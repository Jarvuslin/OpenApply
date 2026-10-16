import type { AgendaResponse } from "@openapply/contracts/pilot";
import { workQueueChannel } from "@openapply/contracts/sse";
import { singleton } from "tsyringe";
import { toInputJson } from "@/common/json";
import { publish } from "@/common/sse";
import { type Prisma, PrismaClient } from "@/generated/prisma/client";
import { companyExcluded } from "@/modules/application-rules/application-rules.guard";
import { AgendaService } from "@/modules/pilot/agenda/agenda.service";
import { enqueueApplications, lockWorkUser } from "./work-queue.admission";
import { workHash } from "./work-queue.policy";

async function schedulePilotWork(
  tx: Prisma.TransactionClient,
  userId: string,
  agenda: AgendaResponse,
  provider: "claude" | "codex",
) {
  const state = await tx.pilotState.findUnique({ where: { userId } });
  if (!state?.running || state.agendaVersion !== agenda.version || agenda.expiresAt <= new Date())
    return { enqueued: 0 };
  let enqueued = 0;
  for (const item of agenda.items) {
    if (item.kind === "job.apply") {
      if (agenda.budget.capReached) continue;
      const job = await tx.job.findFirst({
        where: {
          campaignId: item.payload.campaignId,
          key: item.payload.jobKey,
          status: "approved",
          campaign: { userId, status: "in_progress" },
        },
      });
      if (!job || (await tx.workItem.findUnique({ where: { jobId: job.id } }))) continue;
      // A rule saved after approval must not roll back admission of unrelated eligible jobs.
      if (await companyExcluded(tx, userId, job.company)) continue;
      const items = await enqueueApplications(tx, userId, {
        idempotencyKey: crypto.randomUUID(),
        jobIds: [job.id],
        source: "pilot",
        provider,
      });
      enqueued += items.length;
      continue;
    }
    if (item.kind === "question.answered" && item.payload.subjectType === "job") continue;
    let generation = "";
    if (item.kind === "search.discover") {
      const search = await tx.pilotSearch.findFirst({
        where: { id: item.payload.searchId, userId, nextRunAt: { lte: new Date() } },
      });
      if (!search) continue;
      generation = search.nextRunAt.toISOString();
    }
    const identity = `pilot:${item.kind}:${item.subjectId}:${generation}:${workHash(item.payload)}`;
    if (await tx.workItem.findUnique({ where: { userId_identity: { userId, identity } } }))
      continue;
    let intent: "search" | "inbox" | "campaign_resume" | "unavailable" = "unavailable";
    let campaignId: string | null = null;
    let jobIds: string[] = [];
    if (item.kind === "search.discover") intent = "search";
    else if (item.kind === "inbox.review") intent = "inbox";
    else if (item.kind === "campaign.scorePending" || item.kind === "queue.drain") {
      intent = "campaign_resume";
      campaignId = item.payload.campaignId;
      const jobs = await tx.job.findMany({
        where: {
          campaignId,
          campaign: { userId },
          key: { in: item.payload.entries.map((entry) => entry.key) },
        },
        select: { id: true },
      });
      jobIds = jobs.map((job) => job.id);
      if (!jobIds.length) continue;
    }
    const available = intent !== "unavailable";
    await tx.workItem.create({
      data: {
        userId,
        kind: "pilot_task",
        source: "pilot",
        provider,
        identity,
        intent,
        campaignId,
        title: item.title,
        state: available ? "queued" : "needs_user",
        reason: available
          ? null
          : `Pilot task ${item.kind} requires manual review; automatic execution is unavailable in the common queue.`,
        payload: toInputJson({
          agendaKind: item.kind,
          subjectId: item.subjectId,
          ...item.payload,
          ...(jobIds.length ? { jobIds } : {}),
        }),
      },
    });
    enqueued++;
  }
  await tx.pilotState.update({
    where: { userId },
    data: { lastCycleAt: new Date(), cycleCount: { increment: 1 } },
  });
  return { enqueued };
}

@singleton()
export class WorkQueueSchedulerService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly agenda: AgendaService,
  ) {}

  async schedule(userId: string, provider: "claude" | "codex") {
    const state = await this.prisma.pilotState.findUnique({ where: { userId } });
    if (!state?.running || (state.lastCycleAt && Date.now() - state.lastCycleAt.getTime() < 30_000))
      return { enqueued: 0 };
    const agenda = await this.agenda.refresh(userId);
    const result = await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      return schedulePilotWork(tx, userId, agenda, provider);
    });
    if (result.enqueued) publish(workQueueChannel, { userId }, { type: "work-queue.changed" });
    return result;
  }
}
