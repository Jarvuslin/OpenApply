import type { QUEUE_BLOCK_REASONS, QueueLimits } from "@openapply/contracts/work-queue-limits";
import { HttpError } from "@/common/errors";
import type { Prisma, WorkItem } from "@/generated/prisma/client";
import { validateAccountSetup } from "@/modules/account-setup/account-setup.snapshot";
import { hasJobQuestionBlockers } from "@/modules/application-question/question.resume";
import {
  companyExcluded,
  intakeDecisionPending,
} from "@/modules/application-rules/application-rules.guard";
import { storedPreparation } from "@/modules/intake-preparation/preparation.snapshot";
import { blockedSiteFor } from "@/modules/job-board/blocked-sites";
import { pilotWorkBlockedReason } from "./pilot-work-guard";
import { type ReservationFact, reservationLimit, workScope } from "./work-queue.limits-policy";
import { LIVE_WORK_STATES } from "./work-queue.policy";
import { canonicalWorkOutcome } from "./work-queue.recovery";
import { campaignReservationFull } from "./work-queue.reservations";

type BlockReason = (typeof QUEUE_BLOCK_REASONS)[number];
export async function candidateCapacity(
  tx: Prisma.TransactionClient,
  userId: string,
  item: WorkItem,
  policy: QueueLimits,
  facts: ReservationFact[],
  now: Date,
): Promise<{
  reason: BlockReason | null;
  nextEligibleAt: Date | null;
  scope: ReturnType<typeof workScope>;
  slot: number;
}> {
  const result = {
    reason: null as BlockReason | null,
    nextEligibleAt: null as Date | null,
    scope: null as ReturnType<typeof workScope>,
    slot: 1,
  };
  const blocked = (reason: BlockReason, nextEligibleAt: Date | null = null) => ({
    ...result,
    reason,
    nextEligibleAt,
  });
  if (item.state !== "queued") return blocked("work_not_queued");
  const live = await tx.workItem.findMany({ where: { userId, state: { in: LIVE_WORK_STATES } } });
  const occupied = new Set(live.map((item) => item.workerSlot));
  result.slot = [1, 2, 3].find((slot) => !occupied.has(slot)) ?? 0;
  if (
    live.some((item) => item.kind !== "application") ||
    (item.kind !== "application" && live.length)
  )
    return blocked("exclusive_work");
  if (
    live.length >= (item.kind === "application" ? policy.maxConcurrentWorkers : 1) ||
    !result.slot
  )
    return blocked("capacity");
  if (item.kind !== "application") {
    if (item.intent === "account_setup") {
      try {
        await validateAccountSetup(tx, userId, item);
      } catch (error) {
        if (!(error instanceof HttpError) || ![404, 409, 422].includes(error.status)) throw error;
        return blocked("settled_request");
      }
    }
    if (item.intent === "intake_prepare") {
      if (
        item.attempts !== 0 ||
        item.finishedAt ||
        item.cancellationRequestedAt ||
        item.pauseRequestedAt
      )
        return blocked("settled_request");
      try {
        storedPreparation(item);
      } catch {
        return blocked("unknown_scope");
      }
    }
    return (await pilotWorkBlockedReason(tx, userId, item)) ? blocked("pilot_limit") : result;
  }
  const job = await tx.job.findFirst({
    where: { id: item.jobId!, campaign: { userId } },
    include: { campaign: true },
  });
  if (job?.campaign.status !== "in_progress") return blocked("campaign_paused");
  if (blockedSiteFor(job.url)) return blocked("blocked_site");
  if (job.intakeDecisionRequired || (await intakeDecisionPending(tx, userId, job.url)))
    return blocked("user_decision");
  if (await companyExcluded(tx, userId, job.company)) return blocked("company_excluded");
  result.scope = workScope(job);
  if (!result.scope) return blocked("unknown_scope");
  const outcome = await canonicalWorkOutcome(tx, item, "completed");
  if (outcome.ambiguous || outcome.state === "submitted") return blocked("submission_outcome");
  // An unscanned form is recorded by the worker itself during the run.
  if (await hasJobQuestionBlockers(tx, userId, job.id)) return blocked("questions");
  if (await pilotWorkBlockedReason(tx, userId, item, facts.filter((fact) => fact.held).length))
    return blocked("pilot_limit");
  const limit = reservationLimit(facts, policy, result.scope.companyKey, now);
  if (limit) return blocked(limit);
  if (await campaignReservationFull(tx, userId, job.campaignId, job.id, facts))
    return blocked("campaign_cap");
  const activeDomain = await tx.workExecution.findFirst({
    where: { userId, domainKey: result.scope.domainKey, finishedAt: null },
  });
  if (activeDomain) return blocked("domain_busy");
  const gate = await tx.workDomainGate.findUnique({
    where: { userId_domainKey: { userId, domainKey: result.scope.domainKey } },
  });
  if (gate && gate.nextStartAt > now) return blocked("domain_pacing", gate.nextStartAt);
  return result;
}
