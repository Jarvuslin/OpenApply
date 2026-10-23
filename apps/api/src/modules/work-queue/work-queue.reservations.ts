import { campaignConfigSchema } from "@openapply/contracts/campaign";
import { queueLimitsSchema } from "@openapply/contracts/work-queue-limits";
import { conflict } from "@/common/errors";
import type { Prisma, WorkItem } from "@/generated/prisma/client";
import { canonicalizeJobUrl } from "@/modules/application/job-url";
import { findSubmissionAttempt } from "@/modules/application/submission-attempt-state";
import { assertApplicationAllowed } from "@/modules/application-rules/application-rules.guard";
import { blockedSiteFor } from "@/modules/job-board/blocked-sites";
import { normalizeCompanyName } from "@/modules/scoring/applied-duplicates";
import { pilotWorkBlockedReason } from "./pilot-work-guard";
import { type ReservationFact, reservationLimit, workScope } from "./work-queue.limits-policy";
import { LIVE_WORK_STATES } from "./work-queue.policy";

export async function readQueuePolicy(tx: Prisma.TransactionClient, userId: string) {
  const policy = await tx.queuePolicy.findUnique({ where: { userId } });
  if (!policy) throw conflict("Queue limits have not been initialized for this account.");
  return queueLimitsSchema.parse(policy);
}

export async function reservationFacts(
  tx: Prisma.TransactionClient,
  userId: string,
  excludeExecutionId?: string,
) {
  const [applications, attempts, executions] = await Promise.all([
    tx.application.findMany({
      where: { userId },
      select: { id: true, url: true, company: true, appliedAt: true },
    }),
    tx.submissionAttempt.findMany({
      where: {
        userId,
        OR: [
          { startedAt: { not: null } },
          { legacyOutcomeUnknown: true },
          { recordedAt: { not: null } },
        ],
      },
    }),
    tx.workExecution.findMany({ where: { userId, kind: "application", releasedAt: null } }),
  ]);
  const facts = new Map<string, ReservationFact>();
  for (const app of applications) {
    const identity = canonicalizeJobUrl(app.url);
    const prior = facts.get(identity);
    if (!prior || prior.at < app.appliedAt)
      facts.set(identity, {
        identity,
        companyKey: normalizeCompanyName(app.company) || null,
        at: app.appliedAt,
        unresolved: false,
        held: false,
      });
  }
  for (const attempt of attempts) {
    const identity = attempt.canonicalUrl ?? canonicalizeJobUrl(attempt.originalUrl);
    const checkpoint = attempt.checkpoint as { job?: { company?: string } } | null;
    const companyKey = checkpoint?.job?.company
      ? normalizeCompanyName(checkpoint.job.company) || null
      : null;
    const prior = facts.get(identity);
    const unresolved = !attempt.recordedAt;
    if (unresolved || !prior)
      facts.set(identity, {
        identity,
        companyKey: companyKey ?? prior?.companyKey ?? null,
        at: attempt.recordedAt ?? attempt.startedAt ?? attempt.createdAt,
        unresolved,
        held: false,
      });
  }
  for (const execution of executions) {
    if (execution.id === excludeExecutionId || !execution.canonicalUrl) continue;
    if (!facts.has(execution.canonicalUrl))
      facts.set(execution.canonicalUrl, {
        identity: execution.canonicalUrl,
        companyKey: execution.companyKey,
        at: execution.consumedAt ?? execution.startedAt,
        unresolved: !!execution.consumedAt,
        held: !execution.consumedAt,
      });
  }
  return [...facts.values()];
}

// Always under the account lock. Releasing a slot is separate from releasing a submission reservation.
export async function settleWorkExecution(tx: Prisma.TransactionClient, item: WorkItem) {
  if (!item.currentExecutionId) return;
  const execution = await tx.workExecution.findFirst({
    where: { id: item.currentExecutionId, userId: item.userId },
  });
  if (!execution) throw conflict("Work execution ownership is missing.");
  const attempt = execution.canonicalUrl
    ? await findSubmissionAttempt(tx, item.userId, {
        jobId: execution.jobId ?? undefined,
        url: execution.canonicalUrl,
      })
    : null;
  const consumed =
    !!execution.consumedAt ||
    !!attempt?.startedAt ||
    !!attempt?.legacyOutcomeUnknown ||
    !!attempt?.recordedAt;
  await tx.workExecution.update({
    where: { id: execution.id },
    data: {
      finishedAt: execution.finishedAt ?? new Date(),
      ...(consumed
        ? {
            consumedAt: execution.consumedAt ?? attempt?.startedAt ?? new Date(),
            submissionAttemptId: attempt?.id ?? execution.submissionAttemptId,
            releasedAt: null,
          }
        : { releasedAt: execution.releasedAt ?? new Date() }),
    },
  });
}

export async function assertExecutionReservation(
  tx: Prisma.TransactionClient,
  userId: string,
  item: WorkItem,
) {
  const execution = item.currentExecutionId
    ? await tx.workExecution.findFirst({
        where: { id: item.currentExecutionId, userId, workItemId: item.id, finishedAt: null },
      })
    : null;
  if (execution?.kind !== "application" || execution.releasedAt)
    throw conflict("Submit requires the current isolated application execution reservation.");
  const job = await tx.job.findFirst({ where: { id: item.jobId!, campaign: { userId } } });
  const scope = job && workScope(job);
  if (job) await assertApplicationAllowed(tx, userId, job);
  if (job && blockedSiteFor(job.url))
    throw conflict("This site does not permit automated application work.");
  if (
    !scope ||
    scope.canonicalUrl !== execution.canonicalUrl ||
    scope.companyKey !== execution.companyKey ||
    scope.domainKey !== execution.domainKey
  )
    throw conflict("The job scope changed after the execution reservation.");
  const policy = await readQueuePolicy(tx, userId);
  const facts = await reservationFacts(tx, userId, execution.id);
  if (await campaignReservationFull(tx, userId, job!.campaignId, job!.id, facts))
    throw conflict("The campaign application limit is reserved by active or recorded work.");
  const pilotBlock = await pilotWorkBlockedReason(
    tx,
    userId,
    item,
    facts.filter((fact) => fact.held).length,
  );
  if (pilotBlock) throw conflict(pilotBlock);
  const reason = reservationLimit(facts, policy, scope.companyKey, new Date());
  if (reason) throw conflict(`Application limit reached (${reason}).`);
  return execution;
}

export async function campaignReservationFull(
  tx: Prisma.TransactionClient,
  userId: string,
  campaignId: string,
  excludedJobId: string,
  facts: ReservationFact[],
) {
  const campaign = await tx.campaign.findFirst({ where: { campaignId, userId } });
  if (!campaign) return true;
  const config = campaignConfigSchema.parse(campaign.config);
  const cap = config.maxApplications ?? (config.discovery ? 5 : null);
  if (!cap) return false;
  const jobs = await tx.job.findMany({
    where: { campaignId },
    include: { submissionAttempt: true },
  });
  const reserved = new Set(
    jobs
      .filter(
        (job) =>
          job.id !== excludedJobId &&
          (job.status === "applying" ||
            job.status === "applied" ||
            job.submissionAttempt?.startedAt ||
            job.submissionAttempt?.legacyOutcomeUnknown ||
            facts.some((fact) => fact.identity === canonicalizeJobUrl(job.url))),
      )
      .map((job) => job.id),
  );
  const held = await tx.workExecution.findMany({
    where: {
      userId,
      kind: "application",
      releasedAt: null,
      jobId: { in: jobs.filter((job) => job.id !== excludedJobId).map((job) => job.id) },
    },
  });
  for (const execution of held) if (execution.jobId) reserved.add(execution.jobId);
  return reserved.size >= cap;
}

export async function releaseSettledExecutions(tx: Prisma.TransactionClient, userId: string) {
  const executions = await tx.workExecution.findMany({ where: { userId, finishedAt: null } });
  for (const execution of executions) {
    const item = await tx.workItem.findFirst({ where: { id: execution.workItemId, userId } });
    if (item && item.currentExecutionId === execution.id && LIVE_WORK_STATES.includes(item.state))
      continue;
    if (item && item.currentExecutionId === execution.id) await settleWorkExecution(tx, item);
    else {
      const attempt = execution.canonicalUrl
        ? await findSubmissionAttempt(tx, userId, {
            jobId: execution.jobId ?? undefined,
            url: execution.canonicalUrl,
          })
        : null;
      const consumed =
        !!execution.consumedAt ||
        !!attempt?.startedAt ||
        !!attempt?.legacyOutcomeUnknown ||
        !!attempt?.recordedAt;
      await tx.workExecution.update({
        where: { id: execution.id },
        data: {
          finishedAt: new Date(),
          ...(consumed
            ? {
                consumedAt: execution.consumedAt ?? attempt?.startedAt ?? new Date(),
                submissionAttemptId: attempt?.id ?? execution.submissionAttemptId,
              }
            : { releasedAt: new Date() }),
        },
      });
    }
  }
}
