import { conflict } from "@/common/errors";
import type { Prisma } from "@/generated/prisma/client";
import { hasJobQuestionBlockers } from "@/modules/application-question/question.resume";
import { pilotWorkBlockedReason } from "./pilot-work-guard";
import { lockWorkUser } from "./work-queue.admission";
import { checkWorkLease } from "./work-queue.policy";
import { assertExecutionReservation } from "./work-queue.reservations";

export async function assertSubmissionLease(
  tx: Prisma.TransactionClient,
  userId: string,
  jobId: string,
  workItemId?: string,
  leaseToken?: string,
) {
  if (!workItemId || !leaseToken)
    throw conflict("Submit requires an active common-queue application lease.");
  await lockWorkUser(tx, userId);
  const item = await tx.workItem.findFirst({
    where: { id: workItemId, userId, jobId, kind: "application" },
  });
  if (!item) throw conflict("This work item does not authorize submission for the owned job.");
  checkWorkLease(item, leaseToken);
  if (await hasJobQuestionBlockers(tx, userId, jobId))
    throw conflict("Resolve application questions and form coverage before Submit.");
  const blocked = await pilotWorkBlockedReason(tx, userId, item);
  if (blocked) throw conflict(blocked);
  if (item.pauseRequestedAt || item.cancellationRequestedAt || item.state === "stopping")
    throw conflict("Work is paused or stopping; no new Submit is allowed.");
  return assertExecutionReservation(tx, userId, item);
}
