import {
  type SubmissionAttemptView,
  submissionCheckpointSchema,
  submissionReceiptInputSchema,
} from "@openapply/contracts/submission";
import type { Prisma, SubmissionAttempt } from "@/generated/prisma/client";
import { canonicalizeJobUrl } from "./job-url";

type AttemptReader = Pick<Prisma.TransactionClient, "submissionAttempt">;

export async function findSubmissionAttempt(
  db: AttemptReader,
  userId: string,
  job: { jobId?: string; url: string },
): Promise<SubmissionAttempt | null> {
  const canonicalUrl = canonicalizeJobUrl(job.url);
  const current = await db.submissionAttempt.findFirst({
    where: { userId, OR: [{ canonicalUrl }, ...(job.jobId ? [{ jobId: job.jobId }] : [])] },
  });
  if (current) return current;
  // Migration retains raw URLs honestly. Read every legacy reservation without truncating the lock set.
  let cursor: string | undefined;
  for (;;) {
    const page = await db.submissionAttempt.findMany({
      where: { userId, legacyOutcomeUnknown: true },
      orderBy: { id: "asc" },
      take: 100,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });
    const match = page.find((attempt) => canonicalizeJobUrl(attempt.originalUrl) === canonicalUrl);
    if (match) return match;
    if (page.length < 100) return null;
    cursor = page[page.length - 1].id;
  }
}

export function submissionAttemptView(attempt: SubmissionAttempt): SubmissionAttemptView {
  let state: SubmissionAttemptView["state"] = "prepared";
  if (attempt.startedAt || attempt.legacyOutcomeUnknown) state = "unknown";
  if (attempt.receiptStoredAt) state = "recording_pending";
  if (attempt.recordedAt) state = "recorded";
  return {
    id: attempt.id,
    jobId: attempt.jobId,
    originalUrl: attempt.originalUrl,
    canonicalUrl: attempt.canonicalUrl ?? canonicalizeJobUrl(attempt.originalUrl),
    state,
    legacyOutcomeUnknown: attempt.legacyOutcomeUnknown,
    checkpointId: attempt.checkpointId,
    checkpoint:
      attempt.checkpoint === null ? null : submissionCheckpointSchema.parse(attempt.checkpoint),
    startedAt: attempt.startedAt,
    receipt: attempt.receipt === null ? null : submissionReceiptInputSchema.parse(attempt.receipt),
    receiptStoredAt: attempt.receiptStoredAt,
    recordedAt: attempt.recordedAt,
    applicationId: attempt.applicationId,
    createdAt: attempt.createdAt,
    updatedAt: attempt.updatedAt,
  };
}
