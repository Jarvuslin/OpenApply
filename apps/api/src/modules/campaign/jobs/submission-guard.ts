import { conflict } from "@/common/errors";
import type { Prisma, SubmissionAttempt } from "@/generated/prisma/client";
import { findSubmissionAttempt } from "@/modules/application/submission-attempt-state";

type AttemptReader = Pick<Prisma.TransactionClient, "submissionAttempt">;
interface SubmissionJob {
  id?: string;
  url: string;
}

export const SUBMISSION_NOT_STARTED = {
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
} satisfies Prisma.JobWhereInput;

export function submissionConflict(attempt: SubmissionAttempt | null, jobId?: string): boolean {
  return (
    attempt !== null &&
    (attempt.jobId !== jobId ||
      attempt.legacyOutcomeUnknown ||
      attempt.startedAt !== null ||
      attempt.receiptStoredAt !== null ||
      attempt.recordedAt !== null)
  );
}

export const SUBMISSION_RECOVERY_NOTE =
  "Submission outcome requires recovery. Inspect the saved checkpoint and employer confirmation; do not submit again.";

export async function assertNoSubmissionConflict(
  db: AttemptReader,
  userId: string,
  job: SubmissionJob,
): Promise<void> {
  const attempt = await findSubmissionAttempt(db, userId, { jobId: job.id, url: job.url });
  if (!submissionConflict(attempt, job.id)) return;
  if (attempt?.recordedAt)
    throw conflict("This posting already has a recorded submission. Do not submit again.");
  if (attempt?.receiptStoredAt)
    throw conflict(
      "Employer confirmation is saved. Recover the application record from that receipt; do not submit again.",
    );
  if (attempt?.startedAt || attempt?.legacyOutcomeUnknown) throw conflict(SUBMISSION_RECOVERY_NOTE);
  throw conflict(
    "Another job already holds the saved preparation for this posting. Continue that job instead of starting a duplicate.",
  );
}
