import { needsYouChannel, workQueueChannel } from "@openapply/contracts/sse";
import {
  type WorkClaimInput,
  workClaimInputSchema,
  workClaimSchema,
} from "@openapply/contracts/work-queue";
import type { QUEUE_BLOCK_REASONS } from "@openapply/contracts/work-queue-limits";
import { singleton } from "tsyringe";
import { conflict, notFound } from "@/common/errors";
import { toInputJson } from "@/common/json";
import { publish } from "@/common/sse";
import { PrismaClient } from "@/generated/prisma/client";
import {
  storedAccountSetup,
  validateAccountSetup,
} from "@/modules/account-setup/account-setup.snapshot";
import { verifyDocumentBinding } from "@/modules/application-question/document.store";
import { recomputeQuestionBlockers } from "@/modules/application-question/question.store";
import {
  storedPreparation,
  validatePreparation,
} from "@/modules/intake-preparation/preparation.snapshot";
import { ResumeArtifactService } from "@/modules/resume/resume-artifact.service";
import { ScoringService } from "@/modules/scoring/scoring.service";
import { lockWorkUser } from "./work-queue.admission";
import { candidateCapacity } from "./work-queue.capacity";
import { workExecution } from "./work-queue.execution";
import { checkWorkLease, LIVE_WORK_STATES, WORK_LEASE_MS, workHash } from "./work-queue.policy";
import { canonicalWorkOutcome } from "./work-queue.recovery";
import {
  readQueuePolicy,
  releaseSettledExecutions,
  reservationFacts,
} from "./work-queue.reservations";
import { WorkQueueService } from "./work-queue.service";
import { workItemView } from "./work-queue.view";

@singleton()
export class WorkQueueClaimService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: WorkQueueService,
    private readonly artifacts: ResumeArtifactService,
    private readonly scoring: ScoringService,
  ) {}

  async claim(userId: string, raw: WorkClaimInput) {
    const input = workClaimInputSchema.parse(raw);
    await this.queue.refresh(userId);
    let invalidJob: string | null = null;
    const result = await this.prisma.$transaction(
      async (tx) => {
        await lockWorkUser(tx, userId);
        await releaseSettledExecutions(tx, userId);
        const policy = await readQueuePolicy(tx, userId);
        const now = new Date();
        const payloadHash = workHash({ operation: "claim-v7", input });
        const prior = await tx.workRequest.findUnique({
          where: { userId_idempotencyKey: { userId, idempotencyKey: input.requestId } },
        });
        const denied = (
          reason: (typeof QUEUE_BLOCK_REASONS)[number],
          nextEligibleAt: Date | null = null,
        ) => ({ claim: null, serverTime: now, blockedReason: reason, nextEligibleAt });
        if (prior) {
          if (prior.payloadHash !== payloadHash)
            throw conflict("Claim request identity was used with different details.");
          const saved = prior.response as {
            executionId?: string;
            reason?: (typeof QUEUE_BLOCK_REASONS)[number];
            nextEligibleAt?: string | null;
          } | null;
          if (!saved?.executionId)
            return denied(
              saved?.reason ?? "settled_request",
              saved?.nextEligibleAt ? new Date(saved.nextEligibleAt) : null,
            );
          const item = await tx.workItem.findFirst({
            where: { id: input.workItemId, userId, currentExecutionId: saved.executionId },
          });
          if (
            !item ||
            !LIVE_WORK_STATES.includes(item.state) ||
            !item.leaseToken ||
            !item.leaseExpiresAt ||
            item.leaseExpiresAt <= now ||
            item.pauseRequestedAt ||
            item.cancellationRequestedAt
          )
            return denied("settled_request");
          checkWorkLease(item, item.leaseToken);
          if (item.intent === "account_setup") {
            if (!input.capabilities.accountSetup)
              throw conflict("Account setup requires an account-capable runtime.");
            if (storedAccountSetup(item).snapshot.snapshotHash !== input.accountSnapshotHash)
              throw conflict("Account setup claim requires its exact approved snapshot hash.");
            await validateAccountSetup(tx, userId, item, item.leaseToken);
          } else if (input.accountSnapshotHash)
            throw conflict("Account setup grants cannot claim other work.");
          if (item.intent === "intake_prepare") {
            if (storedPreparation(item).snapshotHash !== input.preparationSnapshotHash)
              throw conflict("Preparation claim requires its exact approved snapshot hash.");
            await validatePreparation(tx, this.scoring, userId, item, item.leaseToken);
          } else if (input.preparationSnapshotHash)
            throw conflict("Preparation grants can claim only preparation work.");
          const execution = await tx.workExecution.findUniqueOrThrow({
            where: { id: saved.executionId },
          });
          return {
            claim: {
              item: await workItemView(tx, userId, item),
              leaseToken: item.leaseToken,
              execution: await workExecution(tx, userId, item),
              ownership: {
                runtimeId: execution.runtimeId,
                workerId: execution.workerId,
                slot: execution.slot,
                executionId: execution.id,
                browserSessionId: execution.browserSessionId,
              },
              leaseExpiresAt: item.leaseExpiresAt,
              policyRevision: execution.policyRevision,
            },
            serverTime: now,
            blockedReason: null,
            nextEligibleAt: null,
          };
        }
        const item = await tx.workItem.findFirst({ where: { id: input.workItemId, userId } });
        if (!item) throw notFound("Owned work item not found.");
        if (item.intent === "account_setup") {
          if (!input.capabilities.accountSetup)
            throw conflict("Account setup requires an account-capable runtime.");
          if (storedAccountSetup(item).snapshot.snapshotHash !== input.accountSnapshotHash)
            throw conflict("Account setup claim requires its exact approved snapshot hash.");
          await validateAccountSetup(tx, userId, item);
        } else if (input.accountSnapshotHash)
          throw conflict("Account setup grants cannot claim other work.");
        if (item.intent === "intake_prepare") {
          if (storedPreparation(item).snapshotHash !== input.preparationSnapshotHash)
            throw conflict("Preparation claim requires its exact approved snapshot hash.");
          await validatePreparation(tx, this.scoring, userId, item);
        } else if (input.preparationSnapshotHash)
          throw conflict("Preparation grants can claim only preparation work.");
        const capacity = await candidateCapacity(
          tx,
          userId,
          item,
          policy,
          await reservationFacts(tx, userId),
          now,
        );
        let reason = capacity.reason;
        if (
          await tx.workExecution.findFirst({
            where: {
              userId,
              runtimeId: input.runtimeId,
              workerId: input.workerId,
              finishedAt: null,
            },
          })
        )
          reason = "capacity";
        if (!reason && item.kind === "application") {
          const selections = await tx.applicationDocumentSelection.findMany({
            where: { userId, jobId: item.jobId!, current: true, question: { current: true } },
          });
          const overBudget =
            selections.length > 4 ||
            selections.reduce((total, selection) => total + selection.sizeBytes, 0) > 10_000_000;
          for (const selection of selections) {
            try {
              if (overBudget)
                throw conflict("Selected document set exceeds the bounded preparation limit.");
              await verifyDocumentBinding(tx, this.artifacts, userId, selection);
            } catch {
              await tx.applicationDocumentSelection.update({
                where: { id: selection.id },
                data: {
                  invalidatedAt: now,
                  invalidReason:
                    "The selected PDF or original source failed the pre-execution integrity check. Inspect and explicitly select a valid artifact.",
                },
              });
              reason = "artifact_unavailable";
              invalidJob = item.jobId;
            }
          }
          if (invalidJob) {
            await tx.job.update({ where: { id: invalidJob }, data: { updatedAt: now } });
            await recomputeQuestionBlockers(tx, userId, invalidJob);
          }
        }
        if (reason) {
          const state =
            reason === "campaign_paused"
              ? "paused"
              : [
                    "questions",
                    "artifact_unavailable",
                    "blocked_site",
                    "unknown_scope",
                    "submission_outcome",
                  ].includes(reason)
                ? "needs_user"
                : item.state;
          const canonical =
            reason === "submission_outcome"
              ? await canonicalWorkOutcome(tx, item, "completed")
              : null;
          await tx.workItem.update({
            where: { id: item.id },
            data: { state: canonical?.state ?? state, reason: `Execution deferred: ${reason}.` },
          });
          await tx.workRequest.create({
            data: {
              userId,
              idempotencyKey: input.requestId,
              payloadHash,
              itemIds: [item.id],
              response: toInputJson({
                reason,
                nextEligibleAt: capacity.nextEligibleAt?.toISOString() ?? null,
              }),
            },
          });
          return denied(reason, capacity.nextEligibleAt);
        }
        const runsRemaining = policy.runsRemaining ?? null;
        if (runsRemaining === 0) return denied("run_limit");
        const ownership = {
          runtimeId: input.runtimeId,
          workerId: input.workerId,
          slot: capacity.slot,
          executionId: crypto.randomUUID(),
          browserSessionId: crypto.randomUUID(),
        };
        await tx.workExecution.create({
          data: {
            id: ownership.executionId,
            userId,
            workItemId: item.id,
            jobId: item.jobId,
            kind: item.kind,
            runtimeId: input.runtimeId,
            workerId: input.workerId,
            slot: capacity.slot,
            browserSessionId: ownership.browserSessionId,
            policyRevision: policy.revision,
            ...capacity.scope,
          },
        });
        if (capacity.scope)
          await tx.workDomainGate.upsert({
            where: { userId_domainKey: { userId, domainKey: capacity.scope.domainKey } },
            create: {
              userId,
              domainKey: capacity.scope.domainKey,
              nextStartAt: new Date(now.getTime() + policy.domainDelaySeconds * 1000),
            },
            update: { nextStartAt: new Date(now.getTime() + policy.domainDelaySeconds * 1000) },
          });
        const leaseToken = crypto.randomUUID();
        const leaseExpiresAt = new Date(now.getTime() + WORK_LEASE_MS);
        const claimed = await tx.workItem.update({
          where: { id: item.id },
          data: {
            state: "preparing",
            leaseToken,
            currentExecutionId: ownership.executionId,
            workerSlot: capacity.slot,
            leaseExpiresAt,
            heartbeatAt: now,
            startedAt: now,
            finishedAt: null,
            attempts: { increment: 1 },
            reason: null,
          },
        });
        if (runsRemaining !== null)
          await tx.queuePolicy.update({
            where: { userId },
            data: { runsRemaining: runsRemaining - 1 },
          });
        await tx.workRequest.create({
          data: {
            userId,
            idempotencyKey: input.requestId,
            payloadHash,
            itemIds: [item.id],
            response: { executionId: ownership.executionId },
          },
        });
        return {
          claim: {
            item: await workItemView(tx, userId, claimed),
            leaseToken,
            execution: await workExecution(tx, userId, claimed),
            ownership,
            leaseExpiresAt,
            policyRevision: policy.revision,
          },
          serverTime: now,
          blockedReason: null,
          nextEligibleAt: null,
        };
      },
      { timeout: 30_000 },
    );
    publish(workQueueChannel, { userId }, { type: "work-queue.changed", itemId: input.workItemId });
    if (invalidJob)
      publish(needsYouChannel, { userId }, { type: "needs-you.changed", jobId: invalidJob });
    return workClaimSchema.parse(result);
  }
}
