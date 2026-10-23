import {
  workObserverQuerySchema,
  workObserverSchema,
  workOrderedInputSchema,
  workOrderedSchema,
} from "@openapply/contracts/work-queue";
import { singleton } from "tsyringe";
import type { z } from "zod/v4";
import { HttpError, notFound } from "@/common/errors";
import { PrismaClient } from "@/generated/prisma/client";
import { validateAccountSetup } from "@/modules/account-setup/account-setup.snapshot";
import { validatePreparation } from "@/modules/intake-preparation/preparation.snapshot";
import { ScoringService } from "@/modules/scoring/scoring.service";
import { lockWorkUser } from "./work-queue.admission";
import { candidateCapacity } from "./work-queue.capacity";
import { LIVE_WORK_STATES } from "./work-queue.policy";
import { readQueuePolicy, reservationFacts } from "./work-queue.reservations";

@singleton()
export class WorkQueueReadService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly scoring: ScoringService,
  ) {}

  async ordered(userId: string, raw: z.infer<typeof workOrderedInputSchema>) {
    const input = workOrderedInputSchema.parse(raw);
    return this.prisma.$transaction(
      async (tx) => {
        await lockWorkUser(tx, userId);
        const items = await tx.workItem.findMany({
          where: { userId, id: { in: input.workItemIds } },
          orderBy: [
            { priorityRequestedAt: { sort: "asc", nulls: "last" } },
            { createdAt: "asc" },
            { id: "asc" },
          ],
        });
        if (items.length !== input.workItemIds.length)
          throw notFound("Every requested work item must belong to this account.");
        const policy = await readQueuePolicy(tx, userId),
          facts = await reservationFacts(tx, userId),
          now = new Date();
        const results = [];
        for (const item of items) {
          const capacity = await candidateCapacity(tx, userId, item, policy, facts, now);
          if (!capacity.reason && item.intent === "intake_prepare") {
            try {
              await validatePreparation(tx, this.scoring, userId, item);
            } catch (error) {
              if (!(error instanceof HttpError) || ![404, 409, 422].includes(error.status))
                throw error;
              capacity.reason = error.status === 422 ? "artifact_unavailable" : "unknown_scope";
            }
          }
          results.push({
            workItemId: item.id,
            eligible: capacity.reason === null,
            blockedReason: capacity.reason,
            nextEligibleAt: capacity.nextEligibleAt,
            priorityRequestedAt: item.priorityRequestedAt,
          });
        }
        return workOrderedSchema.parse({ serverTime: now, items: results });
      },
      { timeout: 30_000 },
    );
  }

  async observer(userId: string, id: string, raw: z.infer<typeof workObserverQuerySchema>) {
    const input = workObserverQuerySchema.parse(raw);
    return this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      const item = await tx.workItem.findFirst({ where: { id, userId } });
      const execution = await tx.workExecution.findFirst({
        where: {
          id: input.executionId,
          userId,
          workItemId: id,
          browserSessionId: input.browserSessionId,
        },
      });
      if (!item || !execution) throw notFound("Owned browser execution not found.");
      let active =
        item.currentExecutionId === execution.id &&
        !!item.leaseToken &&
        !!item.leaseExpiresAt &&
        item.leaseExpiresAt > new Date() &&
        LIVE_WORK_STATES.includes(item.state) &&
        item.state !== "stopping" &&
        !item.pauseRequestedAt &&
        !item.cancellationRequestedAt &&
        !item.finishedAt &&
        !execution.finishedAt &&
        !execution.releasedAt;
      if (active && item.intent === "intake_prepare") {
        try {
          await validatePreparation(tx, this.scoring, userId, item, item.leaseToken!);
        } catch (error) {
          if (!(error instanceof HttpError) || ![404, 409, 422].includes(error.status)) throw error;
          active = false;
        }
      }
      if (active && item.intent === "account_setup") {
        try {
          await validateAccountSetup(tx, userId, item, item.leaseToken!);
        } catch (error) {
          if (!(error instanceof HttpError) || ![404, 409, 422].includes(error.status)) throw error;
          active = false;
        }
      }
      return workObserverSchema.parse({
        ownerId: userId,
        workItemId: id,
        executionId: execution.id,
        browserSessionId: execution.browserSessionId,
        currentExecutionId: item.currentExecutionId,
        state: item.state,
        leaseExpiresAt: item.leaseExpiresAt,
        active,
      });
    });
  }
}
