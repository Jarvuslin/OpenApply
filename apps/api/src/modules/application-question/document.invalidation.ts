import { needsYouChannel, workQueueChannel } from "@openapply/contracts/sse";
import { publish } from "@/common/sse";
import type { Prisma } from "@/generated/prisma/client";
import { selectionDatabaseProblem } from "./document.policy";
import { recomputeQuestionBlockers } from "./question.store";

// Call after the source write under the same user lock, before committing any new source identity.
export async function invalidateDocumentSelections(
  tx: Prisma.TransactionClient,
  userId: string,
  resumeId: string,
  variantIds?: string[],
) {
  const selections = await tx.applicationDocumentSelection.findMany({
    where: {
      userId,
      resumeId,
      current: true,
      question: { current: true },
      ...(variantIds ? { variantId: { in: variantIds } } : {}),
    },
  });
  const jobs: string[] = [];
  for (const jobId of new Set(selections.map((selection) => selection.jobId))) {
    const job = await tx.job.findFirst({
      where: { id: jobId, campaign: { userId }, status: { notIn: ["applied", "skipped"] } },
    });
    if (!job) continue;
    let invalid = false;
    for (const selection of selections.filter((selection) => selection.jobId === jobId))
      if (await selectionDatabaseProblem(tx, selection, userId, job.url)) invalid = true;
    if (!invalid) continue;
    await tx.job.update({
      where: { id: jobId },
      data: { updatedAt: new Date(Math.max(Date.now(), job.updatedAt.getTime() + 1)) },
    });
    await recomputeQuestionBlockers(tx, userId, jobId);
    jobs.push(jobId);
  }
  return jobs;
}

export function publishDocumentInvalidation(userId: string, jobIds: string[]) {
  for (const jobId of jobIds)
    publish(needsYouChannel, { userId }, { type: "needs-you.changed", jobId });
  if (jobIds.length) publish(workQueueChannel, { userId }, { type: "work-queue.changed" });
}
