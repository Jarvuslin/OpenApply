import { workQueueChannel } from "@openapply/contracts/sse";
import {
  type QueueEstimate,
  queueEstimateSchema,
  queueLimitsSchema,
  type UpdateQueueLimits,
  updateQueueLimitsSchema,
} from "@openapply/contracts/work-queue-limits";
import { singleton } from "tsyringe";
import { conflict, forbidden } from "@/common/errors";
import { toInputJson } from "@/common/json";
import { publish } from "@/common/sse";
import { PrismaClient } from "@/generated/prisma/client";
import { lockWorkUser } from "./work-queue.admission";
import { candidateCapacity } from "./work-queue.capacity";
import { LIVE_WORK_STATES, workHash } from "./work-queue.policy";
import { readQueuePolicy, reservationFacts } from "./work-queue.reservations";

@singleton()
export class WorkQueueLimitsService {
  constructor(private readonly prisma: PrismaClient) {}
  read(userId: string) {
    return readQueuePolicy(this.prisma, userId);
  }

  async update(userId: string, raw: UpdateQueueLimits, authKind: string) {
    if (authKind !== "session_user")
      throw forbidden("Only the signed-in user can change queue limits.");
    const input = updateQueueLimitsSchema.parse(raw);
    const policy = await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      const payloadHash = workHash({ operation: "queue-limits-v7", input });
      const prior = await tx.workRequest.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey: input.requestId } },
      });
      if (prior) {
        if (prior.payloadHash !== payloadHash)
          throw conflict("Request identity was used with different queue limits.");
        const saved = prior.response as Record<string, unknown>;
        return queueLimitsSchema.parse({
          ...saved,
          updatedAt:
            typeof saved.updatedAt === "string" ? new Date(saved.updatedAt) : saved.updatedAt,
        });
      }
      const current = await readQueuePolicy(tx, userId);
      if (current.revision !== input.expectedRevision)
        throw conflict("Queue limits changed. Review the current limits before saving.");
      const { requestId: _, expectedRevision: __, ...fields } = input;
      const updated = queueLimitsSchema.parse(
        await tx.queuePolicy.update({
          where: { userId },
          data: { ...fields, revision: { increment: 1 } },
        }),
      );
      await tx.workRequest.create({
        data: {
          userId,
          idempotencyKey: input.requestId,
          payloadHash,
          itemIds: [],
          response: toInputJson(updated),
        },
      });
      return updated;
    });
    publish(workQueueChannel, { userId }, { type: "work-queue.changed" });
    return policy;
  }

  async estimate(userId: string, campaignId?: string): Promise<QueueEstimate> {
    return this.prisma.$transaction(
      async (tx) => {
        // A read lock gives a coherent preflight snapshot without claiming, recovering or changing work.
        await lockWorkUser(tx, userId);
        const asOf = new Date();
        const policy = await readQueuePolicy(tx, userId);
        const [items, live, facts, gates] = await Promise.all([
          tx.workItem.findMany({
            where: {
              userId,
              kind: "application",
              state: "queued",
              ...(campaignId ? { campaignId } : {}),
            },
            orderBy: [
              { priorityRequestedAt: { sort: "asc", nulls: "last" } },
              { createdAt: "asc" },
              { id: "asc" },
            ],
          }),
          tx.workItem.findMany({ where: { userId, state: { in: LIVE_WORK_STATES } } }),
          reservationFacts(tx, userId),
          tx.workDomainGate.findMany({ where: { userId } }),
        ]);
        const deferred = new Map<string, QueueEstimate["deferred"][number]>();
        const domains = new Map<string, QueueEstimate["domains"][number]>();
        let eligibleNow = 0;
        const virtualDomains = new Set<string>();
        const projectedFacts = [...facts];
        for (const item of items) {
          const capacity = await candidateCapacity(tx, userId, item, policy, projectedFacts, asOf);
          if (!capacity.reason && live.length + eligibleNow >= policy.maxConcurrentWorkers)
            capacity.reason = "capacity";
          if (!capacity.reason && capacity.scope && virtualDomains.has(capacity.scope.domainKey))
            capacity.reason = "domain_busy";
          if (capacity.reason) {
            const row = deferred.get(capacity.reason) ?? {
              reason: capacity.reason,
              count: 0,
              nextEligibleAt: capacity.nextEligibleAt,
            };
            row.count++;
            if (
              capacity.nextEligibleAt &&
              (!row.nextEligibleAt || capacity.nextEligibleAt < row.nextEligibleAt)
            )
              row.nextEligibleAt = capacity.nextEligibleAt;
            deferred.set(capacity.reason, row);
          } else {
            eligibleNow++;
            if (capacity.scope) {
              virtualDomains.add(capacity.scope.domainKey);
              projectedFacts.push({
                identity: capacity.scope.canonicalUrl,
                companyKey: capacity.scope.companyKey,
                at: asOf,
                unresolved: false,
                held: true,
              });
            }
          }
          if (capacity.scope) {
            const key = capacity.scope.domainKey;
            const row = domains.get(key) ?? {
              domainKey: key,
              queued: 0,
              active: 0,
              nextEligibleAt: gates.find((gate) => gate.domainKey === key)?.nextStartAt ?? null,
            };
            row.queued++;
            domains.set(key, row);
          }
        }
        const executions = await tx.workExecution.findMany({ where: { userId, finishedAt: null } });
        for (const execution of executions)
          if (execution.domainKey) {
            const row = domains.get(execution.domainKey) ?? {
              domainKey: execution.domainKey,
              queued: 0,
              active: 0,
              nextEligibleAt:
                gates.find((gate) => gate.domainKey === execution.domainKey)?.nextStartAt ?? null,
            };
            row.active++;
            domains.set(execution.domainKey, row);
          }
        const day = new Date(asOf);
        day.setUTCHours(0, 0, 0, 0);
        return queueEstimateSchema.parse({
          asOf,
          policy,
          counts: {
            queuedApplications: items.length,
            activeWorkers: live.length,
            heldReservations: facts.filter((fact) => fact.held).length,
            consumedReservations: facts.filter((fact) => fact.unresolved).length,
            submittedToday: facts.filter((fact) => !fact.held && !fact.unresolved && fact.at >= day)
              .length,
            eligibleNow,
            deferred: items.length - eligibleNow,
          },
          deferred: [...deferred.values()],
          domains: [...domains.values()]
            .sort((a, b) => a.domainKey.localeCompare(b.domainKey))
            .slice(0, 100),
          domainCount: domains.size,
          domainsTruncated: domains.size > 100,
          usage: {
            modelRequests: null,
            inputTokens: null,
            outputTokens: null,
            durationMs: null,
            proRemaining: null,
            provenance: "unavailable",
          },
        });
      },
      { timeout: 30_000 },
    );
  }
}
