import { campaignConfigSchema } from "@openapply/contracts/campaign";
import {
  type IntakePreparationSnapshot,
  intakePreparationSnapshotSchema,
} from "@openapply/contracts/intake-preparation";
import type { FitContext } from "@openapply/contracts/scoring";
import { conflict, notFound, unauthorized } from "@/common/errors";
import type { Prisma, WorkItem } from "@/generated/prisma/client";
import { findSubmissionAttempt } from "@/modules/application/submission-attempt-state";
import { assertAutomationAllowed } from "@/modules/job-board/blocked-sites";
import type { ScoringService } from "@/modules/scoring/scoring.service";
import { checkWorkLease, workHash } from "@/modules/work-queue/work-queue.policy";

export function preparationSnapshot(value: Omit<IntakePreparationSnapshot, "snapshotHash">) {
  const scope = intakePreparationSnapshotSchema.omit({ snapshotHash: true }).parse(value);
  return intakePreparationSnapshotSchema.parse({ ...scope, snapshotHash: workHash(scope) });
}

export function storedPreparation(
  item: Pick<WorkItem, "id" | "kind" | "intent" | "payload" | "provider" | "campaignId">,
) {
  const parsed = intakePreparationSnapshotSchema.safeParse(item.payload);
  if (!parsed.success || item.kind !== "pilot_task" || item.intent !== "intake_prepare")
    throw conflict(
      "This preparation payload is unsupported. Explicitly prepare this intake again; no previous grant can execute it.",
    );
  const snapshot = parsed.data;
  const { snapshotHash, ...scope } = snapshot;
  if (
    snapshot.workItemId !== item.id ||
    snapshot.provider !== item.provider ||
    snapshot.campaignId !== item.campaignId ||
    preparationSnapshot(scope).snapshotHash !== snapshotHash
  )
    throw conflict("The immutable preparation scope does not match this work item.");
  return snapshot;
}

export function preparationCredential(authorization: string | undefined) {
  const match = /^Bearer prep\.([a-f0-9-]{36})\.([a-f0-9-]{36})$/i.exec(authorization ?? "");
  if (!match) throw unauthorized("An exact preparation capability is required.");
  const id = intakePreparationSnapshotSchema.shape.workItemId.safeParse(match[1]);
  const lease = intakePreparationSnapshotSchema.shape.workItemId.safeParse(match[2]);
  if (!id.success || !lease.success) throw unauthorized("Invalid preparation capability.");
  return { workItemId: id.data, leaseToken: lease.data };
}

export async function validatePreparation(
  tx: Prisma.TransactionClient,
  scoring: ScoringService,
  userId: string,
  item: WorkItem,
  leaseToken?: string,
) {
  const snapshot = storedPreparation(item);
  if (
    item.userId !== userId ||
    item.cancellationRequestedAt ||
    item.pauseRequestedAt ||
    item.finishedAt
  )
    throw conflict("This preparation has stopped. A new explicit preparation is required.");
  if (leaseToken) {
    checkWorkLease(item, leaseToken);
    if (item.state !== "preparing" || !item.currentExecutionId)
      throw conflict("Preparation requires its current read-only execution lease.");
    const execution = await tx.workExecution.findFirst({
      where: {
        id: item.currentExecutionId,
        userId,
        workItemId: item.id,
        kind: "pilot_task",
        finishedAt: null,
        releasedAt: null,
      },
    });
    if (!execution) throw conflict("Preparation execution has ended.");
  } else if (item.state !== "queued" || item.attempts !== 0 || item.currentExecutionId) {
    throw conflict("Only new, unspent preparation work can be planned or claimed.");
  }
  const intake = await tx.jobIntake.findFirst({ where: { id: snapshot.intakeId, userId } });
  if (
    intake?.decision !== "pending" ||
    intake.revision !== snapshot.intakeRevision ||
    intake.jobId !== snapshot.jobId ||
    intake.canonicalUrl !== snapshot.url ||
    intake.provider !== snapshot.provider ||
    !intake.resolved
  )
    throw conflict("The intake decision, revision or resolved destination changed.");
  const job = await tx.job.findFirst({
    where: { id: snapshot.jobId, campaign: { userId } },
    include: { campaign: true },
  });
  if (!job) throw notFound("Preparation job no longer exists.");
  if (
    job.campaignId !== snapshot.campaignId ||
    job.key !== snapshot.jobKey ||
    job.url !== snapshot.url ||
    job.campaign.status !== "in_progress" ||
    ["approved", "applying", "applied", "skipped", "failed"].includes(job.status)
  )
    throw conflict("The preparation job scope or authorization changed.");
  if (campaignConfigSchema.parse(job.campaign.config).resumeId !== snapshot.resumeId)
    throw conflict("The selected original resume changed.");
  assertAutomationAllowed(job.url);
  const attempt = await findSubmissionAttempt(tx, userId, { jobId: job.id, url: job.url });
  if (attempt?.startedAt || attempt?.legacyOutcomeUnknown || attempt?.recordedAt)
    throw conflict("Submission history requires outcome review, not preparation.");
  const context = await scoring.preparationContext(
    userId,
    { campaignId: snapshot.campaignId, jobKey: snapshot.jobKey, resumeId: snapshot.resumeId },
    tx,
  );
  assertPreparationSource(snapshot, context);
  return { snapshot, job, context };
}

function assertPreparationSource(snapshot: IntakePreparationSnapshot, context: FitContext) {
  const basis = context.basis;
  if (
    basis.resumeId !== snapshot.resumeId ||
    basis.sourceSha256 !== snapshot.sourceSha256 ||
    basis.sourceTextSha256 !== snapshot.sourceTextSha256 ||
    basis.preferencesSha256 !== snapshot.preferencesSha256
  )
    throw conflict("Original resume or preferences changed after this preparation was approved.");
}
