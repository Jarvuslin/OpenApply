import {
  applicationPreparationSchema,
  type PreparationQuery,
} from "@openapply/contracts/application-preparation";
import { isHumanAuthorship } from "@/common/auth/human-actor";
import { conflict, notFound } from "@/common/errors";
import type { Prisma } from "@/generated/prisma/client";
import { findAppliedDuplicate } from "@/modules/application/duplicate";
import { findSubmissionAttempt } from "@/modules/application/submission-attempt-state";
import type { ResumeArtifactService } from "@/modules/resume/resume-artifact.service";
import { sha256 } from "@/modules/resume/resume-artifact-store";
import { checkWorkLease } from "@/modules/work-queue/work-queue.policy";
import { documentPurpose } from "./document.policy";
import { documentSelectionView, verifyDocumentBinding } from "./document.store";
import { questionBlockers } from "./question.resolution";
import { questionInclude, questionView } from "./question.store";

export async function preparationJob(tx: Prisma.TransactionClient, userId: string, jobId: string) {
  const job = await tx.job.findFirst({ where: { id: jobId, campaign: { userId } } });
  if (!job) throw notFound("Owned job not found");
  const attempt = await findSubmissionAttempt(tx, userId, { jobId, url: job.url });
  if (
    job.status === "applied" ||
    job.status === "skipped" ||
    attempt?.startedAt ||
    attempt?.legacyOutcomeUnknown ||
    attempt?.receiptStoredAt ||
    attempt?.recordedAt ||
    (await findAppliedDuplicate(tx, userId, job))
  )
    throw conflict(
      "This job is closed or has unresolved submission evidence; do not replay preparation.",
    );
  return job;
}

export async function preparationLease(
  tx: Prisma.TransactionClient,
  userId: string,
  jobId: string,
  mode: PreparationQuery["mode"],
  workItemId?: string,
  leaseToken?: string,
) {
  if (mode !== "worker") return;
  if (!workItemId || !leaseToken)
    throw conflict("Worker preparation requires the active application lease.");
  const item = await tx.workItem.findFirst({
    where: { id: workItemId, userId, jobId, kind: "application" },
  });
  if (!item) throw conflict("The work item does not own this application.");
  checkWorkLease(item, leaseToken);
  const campaign = await tx.campaign.findFirst({
    where: { campaignId: item.campaignId ?? "", userId },
  });
  if (
    item.pauseRequestedAt ||
    item.cancellationRequestedAt ||
    item.state === "stopping" ||
    campaign?.status !== "in_progress"
  )
    throw conflict("Paused or stopped work cannot mutate an application form.");
}

export async function preparationManifest(
  tx: Prisma.TransactionClient,
  artifacts: ResumeArtifactService,
  userId: string,
  jobId: string,
  query: PreparationQuery,
  workItemId?: string,
  leaseToken?: string,
) {
  const job = await preparationJob(tx, userId, jobId);
  await preparationLease(tx, userId, jobId, query.mode, workItemId, leaseToken);
  const [collection, rows, selections] = await Promise.all([
    tx.jobQuestionCollection.findFirst({ where: { userId, jobId }, orderBy: { version: "desc" } }),
    tx.applicationQuestion.findMany({
      where: { userId, jobId, current: true },
      include: questionInclude,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    tx.applicationDocumentSelection.findMany({ where: { userId, jobId, current: true } }),
  ]);
  const documents = new Map<string, Set<string>>();
  const questions = rows.map((row) => {
    const view = questionView(row);
    if (!row.answers[0]?.confirmedAt || !isHumanAuthorship(row.answers[0].authorship))
      view.answer = null;
    return view;
  });
  const documentFields = [];
  for (const question of questions)
    for (const field of question.definition.fields.filter((field) => field.type === "file")) {
      const purpose = documentPurpose(question.definition, field.key);
      const selected = selections.find(
        (row) => row.questionId === question.id && row.fieldKey === field.key,
      );
      let selection = null;
      if (selected) {
        let problem: string | null = null;
        try {
          await verifyDocumentBinding(tx, artifacts, userId, selected);
        } catch {
          problem =
            "The selected artifact is stale, unavailable, or failed integrity verification.";
        }
        selection = documentSelectionView(selected, problem);
        if (!problem) {
          const fields = documents.get(question.id) ?? new Set<string>();
          fields.add(field.key);
          documents.set(question.id, fields);
        }
      }
      documentFields.push({
        questionId: question.id,
        fieldKey: field.key,
        purpose,
        reason:
          purpose === "resume"
            ? null
            : "Only an explicitly identified resume upload supports document selection.",
        selection,
      });
    }
  const blockers = questionBlockers(rows, documents);
  for (const question of questions) question.blocking = blockers.get(question.id) ?? true;
  const manifest = {
    job,
    collectionVersion: collection?.version ?? 0,
    coverage: collection?.coverage ?? null,
    questions,
    documentFields,
  };
  return applicationPreparationSchema.parse({
    ...manifest,
    mode: query.mode,
    manifestHash: sha256(manifest),
    submissionAllowed: false,
  });
}
