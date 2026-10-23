import type { WorkState } from "@openapply/contracts/work-queue";
import type { Prisma, WorkItem } from "@/generated/prisma/client";
import { parkAccountSetup } from "@/modules/account-setup/account-setup.attention";
import { canonicalizeJobUrl } from "@/modules/application/job-url";
import { findSubmissionAttempt } from "@/modules/application/submission-attempt-state";
import { settledState } from "./work-queue.policy";

export async function canonicalWorkOutcome(
  tx: Prisma.TransactionClient,
  item: WorkItem,
  outcome: "completed" | "failed" | "cancelled" | "waiting",
) {
  if (item.intent === "account_setup") {
    const { attempt } = await parkAccountSetup(tx, item);
    const complete = attempt.phase === "authenticated" && !!attempt.authenticatedAt;
    let state: WorkState = "needs_user";
    if (complete) state = "completed";
    else if (attempt.phase === "skipped") state = "skipped";
    return {
      state,
      applicationId: null,
      ambiguous: attempt.signupAttempts === 1 && !complete,
    };
  }
  const job = item.jobId
    ? await tx.job.findFirst({
        where: { id: item.jobId, campaign: { userId: item.userId } },
        include: { submissionAttempt: true },
      })
    : null;
  const attempt = job
    ? await findSubmissionAttempt(tx, item.userId, { jobId: job.id, url: job.url })
    : null;
  const application = job
    ? await tx.application.findUnique({
        where: { userId_url: { userId: item.userId, url: canonicalizeJobUrl(job.url) } },
        select: { id: true },
      })
    : null;
  const recorded =
    !!attempt?.recordedAt &&
    !!attempt.receiptStoredAt &&
    !!application &&
    attempt.applicationId === application.id &&
    attempt.jobId === job?.id &&
    job?.status === "applied";
  const ambiguous =
    !!application ||
    (!!attempt && !!(attempt.startedAt || attempt.receiptStoredAt || attempt.legacyOutcomeUnknown));
  const state = settledState({
    kind: item.kind,
    recorded,
    ambiguous,
    jobStatus: job?.status,
    pause: !!item.pauseRequestedAt,
    stop: !!item.cancellationRequestedAt,
    outcome,
  });
  return { state, applicationId: recorded ? application.id : null, ambiguous };
}
