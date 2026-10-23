import type { CampaignJobResultInput, CampaignJobStatus } from "@openapply/contracts/campaign";
import { CAMPAIGN_JOB_TERMINAL_OUTCOMES } from "@openapply/contracts/campaign";
import {
  submissionCheckpointSchema,
  submissionReceiptInputSchema,
} from "@openapply/contracts/submission";
import { conflict, findOwned, unprocessable } from "@/common/errors";
import { toInputJson } from "@/common/json";
import type { Application, PrismaClient } from "@/generated/prisma/client";
import { canonicalizeJobUrl } from "@/modules/application/job-url";
import type { SubmissionService } from "@/modules/application/submission.service";
import { findSubmissionAttempt } from "@/modules/application/submission-attempt-state";
import { listingApplicationData } from "@/modules/job-listing/listing-applications";

export function isTerminalJob(status: CampaignJobStatus): boolean {
  return (CAMPAIGN_JOB_TERMINAL_OUTCOMES as readonly string[]).includes(status);
}

/** Receipt persistence is separate: a failed recording transaction must never require another Submit. */
export async function writeJobResult(
  prisma: PrismaClient,
  userId: string,
  campaignId: string,
  key: string,
  data: CampaignJobResultInput,
  submissionFiles: Pick<SubmissionService, "verifyResume">,
) {
  const existing = await findOwned(
    (where) => prisma.job.findFirst({ where, include: { campaign: { select: { source: true } } } }),
    { campaignId, key, campaign: { userId } },
    "Campaign job",
  );
  const { source } = existing.campaign;
  if (isTerminalJob(existing.status)) {
    if (existing.status !== data.outcome)
      throw conflict(`Job already finished with outcome ${existing.status}.`);
    const application =
      data.outcome === "applied"
        ? await prisma.application.findUnique({
            where: { userId_url: { userId, url: canonicalizeJobUrl(existing.url) } },
          })
        : null;
    return { campaignJob: existing, application, source, changed: false };
  }
  const attempt = await findSubmissionAttempt(prisma, userId, {
    jobId: existing.id,
    url: existing.url,
  });
  if (data.outcome !== "applied") {
    if (
      attempt &&
      (attempt.startedAt ||
        attempt.legacyOutcomeUnknown ||
        attempt.receiptStoredAt ||
        attempt.recordedAt)
    )
      throw conflict(
        "Submission outcome requires reconciliation; it cannot be marked failed or skipped or retried.",
      );
    return prisma.$transaction(async (tx) => {
      const held = await tx.job.updateMany({
        where: { id: existing.id, status: existing.status, updatedAt: existing.updatedAt },
        data: { updatedAt: new Date() },
      });
      if (!held.count) throw conflict("Job changed while recording; inspect its submission state.");
      const currentAttempt = await findSubmissionAttempt(tx, userId, {
        jobId: existing.id,
        url: existing.url,
      });
      if (
        currentAttempt &&
        (currentAttempt.startedAt ||
          currentAttempt.legacyOutcomeUnknown ||
          currentAttempt.receiptStoredAt ||
          currentAttempt.recordedAt)
      )
        throw conflict(
          "Submission outcome requires reconciliation; it cannot be marked failed or skipped.",
        );
      const changed = await tx.job.updateMany({
        where: {
          id: existing.id,
          status: { notIn: [...CAMPAIGN_JOB_TERMINAL_OUTCOMES] },
          OR: [
            { submissionAttempt: { is: null } },
            {
              submissionAttempt: {
                is: {
                  startedAt: null,
                  legacyOutcomeUnknown: false,
                  receiptStoredAt: null,
                  recordedAt: null,
                },
              },
            },
          ],
        },
        data: {
          status: data.outcome,
          appliedAt: null,
          failReason: data.outcome === "failed" ? data.failReason : null,
          skipReason: data.outcome === "skipped" ? data.skipReason : null,
          retryNotes: data.retryNotes,
        },
      });
      const job = await tx.job.findUniqueOrThrow({ where: { id: existing.id } });
      if (!changed.count && job.status !== data.outcome)
        throw conflict("Job or submission state changed; inspect its outcome before retrying.");
      return { campaignJob: job, application: null, source, changed: changed.count > 0 };
    });
  }
  if (
    !data.checkpointId ||
    data.appliedAt !== undefined ||
    data.submission !== undefined ||
    data.resumeId !== undefined ||
    data.resumeVariantId !== undefined
  )
    throw unprocessable(
      "A new applied result requires checkpointId only; the stored checkpoint and receipt provide its date, answers and resume.",
    );
  if (
    !attempt ||
    attempt.jobId !== existing.id ||
    attempt.checkpointId !== data.checkpointId ||
    attempt.legacyOutcomeUnknown ||
    !attempt.startedAt ||
    !attempt.receiptStoredAt
  )
    throw unprocessable(
      "A begun checkpoint with a stored employer receipt is required to record an application.",
    );
  const checkpoint = submissionCheckpointSchema.parse(attempt.checkpoint);
  const receipt = submissionReceiptInputSchema.parse(attempt.receipt);
  if (receipt.checkpointId !== attempt.checkpointId)
    throw conflict("Stored receipt does not match the checkpoint.");
  await submissionFiles.verifyResume(userId, existing.id, checkpoint.resume);
  const appliedAt = new Date(receipt.confirmation.observedAt);
  return prisma.$transaction(async (tx) => {
    const locked = await tx.submissionAttempt.updateMany({
      where: {
        id: attempt.id,
        checkpointId: data.checkpointId,
        receiptHash: attempt.receiptHash,
        recordedAt: null,
      },
      data: { recordedAt: new Date() },
    });
    if (!locked.count) {
      const recorded = await tx.submissionAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
      if (!recorded.recordedAt || !recorded.applicationId)
        throw conflict("Submission recording changed concurrently; read the attempt to recover.");
      const application = await tx.application.findUniqueOrThrow({
        where: { id: recorded.applicationId },
      });
      const job = await tx.job.findUniqueOrThrow({ where: { id: existing.id } });
      return { campaignJob: job, application, source, changed: false };
    }
    const changed = await tx.job.updateMany({
      where: { id: existing.id, status: { in: ["applying", "needs_user"] } },
      data: {
        status: "applied",
        appliedAt,
        failReason: null,
        skipReason: null,
        retryNotes: data.retryNotes,
      },
    });
    if (!changed.count)
      throw conflict(
        "Job state changed while recording; the receipt remains saved. Do not submit again.",
      );
    const snapshot = checkpoint.job;
    // Live library links may disappear after Submit; the immutable checkpoint and PDF remain evidence.
    const liveResume = await tx.resume.findFirst({
      where: { id: checkpoint.resumeId, userId },
      select: { id: true },
    });
    const liveVariant =
      liveResume && checkpoint.resumeVariantId
        ? await tx.resumeVariant.findFirst({
            where: { id: checkpoint.resumeVariantId, resumeId: liveResume.id, resume: { userId } },
            select: { id: true },
          })
        : null;
    const application: Application = await tx.application.create({
      data: {
        ...(await listingApplicationData(tx, { ...snapshot, url: snapshot.canonicalUrl })),
        userId,
        url: snapshot.canonicalUrl,
        title: snapshot.title,
        company: snapshot.company,
        location: snapshot.location,
        board: snapshot.board,
        source: snapshot.source,
        campaignId,
        matchScore: snapshot.matchScore,
        matchReason: snapshot.matchReason,
        appliedAt,
        resumeId: liveResume?.id ?? null,
        resumeVariantId: liveVariant?.id ?? null,
        submission: toInputJson({
          version: 1,
          fields: checkpoint.fields,
          resume: checkpoint.resume,
          confirmation: receipt.confirmation,
          previous: [],
        }),
        events: { create: { kind: "status_change", toStatus: "applied", source: "campaign" } },
      },
    });
    await tx.submissionAttempt.update({
      where: { id: attempt.id },
      data: { applicationId: application.id },
    });
    if (liveVariant)
      await tx.resumeVariant.updateMany({
        where: {
          id: liveVariant.id,
          resumeId: checkpoint.resumeId,
          resume: { userId },
          applicationId: null,
        },
        data: { applicationId: application.id },
      });
    await tx.coverLetter.updateMany({
      where: { jobUrl: snapshot.url, applicationId: null, userId },
      data: { applicationId: application.id },
    });
    const job = await tx.job.findUniqueOrThrow({ where: { id: existing.id } });
    return { campaignJob: job, application, source, changed: true };
  });
}
