import type { EnqueueWork } from "@openapply/contracts/work-queue";
import { conflict, notFound } from "@/common/errors";
import type { Prisma } from "@/generated/prisma/client";
import { canonicalizeJobUrl } from "@/modules/application/job-url";
import { findSubmissionAttempt } from "@/modules/application/submission-attempt-state";
import { assertApplicationAllowed } from "@/modules/application-rules/application-rules.guard";
import { assertAutomationAllowed } from "@/modules/job-board/blocked-sites";
import { workHash } from "./work-queue.policy";

export async function lockWorkUser(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
}

export async function enqueueApplications(
  tx: Prisma.TransactionClient,
  userId: string,
  input: EnqueueWork,
) {
  const jobIds = [...new Set(input.jobIds)].sort();
  const payloadHash = workHash({ ...input, jobIds });
  const prior = await tx.workRequest.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
  });
  if (prior) {
    if (prior.payloadHash !== payloadHash)
      throw conflict("Queue request was already used with different details.");
    return tx.workItem.findMany({
      where: { id: { in: prior.itemIds }, userId },
      orderBy: { createdAt: "asc" },
    });
  }
  const jobs = await tx.job.findMany({
    where: { id: { in: jobIds }, campaign: { userId } },
    include: { campaign: true, submissionAttempt: true },
  });
  if (jobs.length !== jobIds.length) throw notFound("One or more owned jobs were not found.");
  const items = [];
  for (const job of jobs) {
    const existing = await tx.workItem.findUnique({ where: { jobId: job.id } });
    assertAutomationAllowed(job.url);
    await assertApplicationAllowed(tx, userId, job);
    if (job.campaign.status !== "in_progress")
      throw conflict("Resume this campaign before queueing its jobs.");
    const attempt = await findSubmissionAttempt(tx, userId, { jobId: job.id, url: job.url });
    const application = await tx.application.findUnique({
      where: { userId_url: { userId, url: canonicalizeJobUrl(job.url) } },
      select: { id: true },
    });
    const recorded =
      !!application &&
      !!attempt?.recordedAt &&
      !!attempt.receiptStoredAt &&
      attempt.applicationId === application.id &&
      attempt.jobId === job.id &&
      job.status === "applied";
    const ambiguous =
      !!attempt && !!(attempt.startedAt || attempt.receiptStoredAt || attempt.legacyOutcomeUnknown);
    let state: "queued" | "submitted" | "needs_user" = "queued";
    let reason: string | null = null;
    if (recorded) state = "submitted";
    else if (
      application ||
      ambiguous ||
      job.status === "applying" ||
      job.status === "applied" ||
      job.status === "needs_user"
    ) {
      state = "needs_user";
      reason =
        "Existing application activity requires review. Queue admission never authorizes another Submit.";
    }
    if (existing) {
      if (input.source !== "pilot" && ["failed", "skipped", "cancelled"].includes(existing.state)) {
        if (ambiguous || application)
          throw conflict("Submission evidence requires recovery, not another application attempt.");
        items.push(
          await tx.workItem.update({
            where: { id: existing.id },
            data: {
              state: "queued",
              provider: input.provider,
              reason: null,
              finishedAt: null,
              cancellationRequestedAt: null,
              pauseRequestedAt: null,
              leaseToken: null,
              leaseExpiresAt: null,
            },
          }),
        );
      } else {
        if (existing.provider !== input.provider)
          throw conflict(
            "This work already uses a different provider. Stop it before explicitly selecting another provider.",
          );
        items.push(existing);
      }
      continue;
    }
    items.push(
      await tx.workItem.create({
        data: {
          userId,
          kind: "application",
          source: input.source,
          provider: input.provider,
          identity: `application:${job.id}`,
          jobId: job.id,
          jobKey: job.key,
          campaignId: job.campaignId,
          title: job.title,
          company: job.company,
          state,
          reason,
          applicationId: recorded ? application.id : null,
        },
      }),
    );
  }
  await tx.workRequest.create({
    data: {
      userId,
      idempotencyKey: input.idempotencyKey,
      payloadHash,
      itemIds: items.map((item) => item.id),
    },
  });
  return items;
}
