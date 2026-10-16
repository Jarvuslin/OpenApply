import { readFile } from "node:fs/promises";
import { documentSelectionSchema } from "@openapply/contracts/application-preparation";
import { questionDefinitionSchema } from "@openapply/contracts/application-question";
import { conflict, notFound, unprocessable } from "@/common/errors";
import { resumePath } from "@/common/storage/storage";
import type { ApplicationDocumentSelection, Prisma } from "@/generated/prisma/client";
import { canonicalizeJobUrl } from "@/modules/application/job-url";
import type { ResumeArtifactService } from "@/modules/resume/resume-artifact.service";
import { sha256 } from "@/modules/resume/resume-artifact-store";
import { documentPurpose, documentSourceSchema, selectionDatabaseProblem } from "./document.policy";

export function documentSelectionView(row: ApplicationDocumentSelection, problem: string | null) {
  return documentSelectionSchema.parse({
    ...row,
    available: problem === null,
    unavailableReason: problem,
    pdfUrl: `/api/application-documents/${row.id}/pdf`,
  });
}

export async function verifyOwnedArtifact(
  tx: Prisma.TransactionClient,
  artifacts: ResumeArtifactService,
  userId: string,
  jobUrl: string,
  input: { resumeId: string; variantId?: string; artifactRevision: string },
) {
  await tx.$queryRaw`SELECT id FROM resumes WHERE id=${input.resumeId} AND user_id=${userId} FOR SHARE`;
  const resume = await tx.resume.findFirst({ where: { id: input.resumeId, userId } });
  if (!resume) throw notFound("Owned resume not found");
  if (input.variantId)
    await tx.$queryRaw`SELECT id FROM resume_variants WHERE id=${input.variantId} AND resume_id=${resume.id} FOR SHARE`;
  const variant = input.variantId
    ? await tx.resumeVariant.findFirst({ where: { id: input.variantId, resumeId: resume.id } })
    : null;
  if (input.variantId && !variant) throw notFound("Owned variant not found");
  const artifact = await artifacts.get(userId, resume.id, input.variantId, input.artifactRevision);
  if (artifact.sizeBytes > 10_000_000)
    throw unprocessable("The selected PDF exceeds the 10-megabyte preparation limit.");
  if (
    artifact.source.version !== resume.version ||
    artifact.source.filename !== resume.sourceFilename ||
    artifact.source.contentSha256 !== (resume.content === null ? null : sha256(resume.content))
  )
    throw conflict("The artifact original source changed; select a current source revision.");
  if (artifact.contentSha256 !== sha256(variant?.content ?? resume.content))
    throw conflict("The saved document content changed; select its current canonical artifact.");
  if (
    (variant?.jobUrl && canonicalizeJobUrl(variant.jobUrl) !== canonicalizeJobUrl(jobUrl)) ||
    (artifact.job.url && canonicalizeJobUrl(artifact.job.url) !== canonicalizeJobUrl(jobUrl))
  )
    throw conflict("This variant belongs to a different job.");
  if (
    resume.sourceFilename &&
    artifact.source.sha256 !== sha256(await readFile(resumePath(resume.sourceFilename)))
  )
    throw conflict("The original resume bytes changed; the artifact source is stale.");
  return {
    artifact,
    source: documentSourceSchema.parse({
      resumeVersion: resume.version,
      sourceFilename: resume.sourceFilename,
      sourceSha256: artifact.source.sha256,
      sourceContentSha256: artifact.source.contentSha256,
      variantContentSha256: variant ? sha256(variant.content) : null,
      variantUpdatedAt: variant?.updatedAt.toISOString() ?? null,
      jobUrl,
    }),
  };
}

export async function verifyDocumentBinding(
  tx: Prisma.TransactionClient,
  artifacts: ResumeArtifactService,
  userId: string,
  row: ApplicationDocumentSelection,
) {
  const question = await tx.applicationQuestion.findFirst({
    where: { id: row.questionId, userId, jobId: row.jobId, current: true },
  });
  const job = await tx.job.findFirst({ where: { id: row.jobId, campaign: { userId } } });
  if (
    !question ||
    !job ||
    question.revision !== row.questionRevision ||
    question.definitionHash !== row.definitionHash
  )
    throw conflict("The selected question revision changed.");
  if (
    documentPurpose(questionDefinitionSchema.parse(question.definition), row.fieldKey) !== "resume"
  )
    throw conflict("This field does not identify a supported resume upload.");
  const problem = await selectionDatabaseProblem(tx, row, userId, job.url);
  if (problem) throw conflict(problem);
  const verified = await verifyOwnedArtifact(tx, artifacts, userId, job.url, {
    resumeId: row.resumeId,
    variantId: row.variantId ?? undefined,
    artifactRevision: row.artifactRevision,
  });
  if (
    verified.artifact.pdfSha256 !== row.pdfSha256 ||
    verified.artifact.sizeBytes !== row.sizeBytes ||
    sha256(verified.source) !== sha256(row.sourceSnapshot)
  )
    throw conflict("The selected artifact bytes or provenance changed.");
  return verified.artifact;
}

export async function assertSelectedDocuments(
  tx: Prisma.TransactionClient,
  artifacts: ResumeArtifactService,
  userId: string,
  jobId: string,
  resume: {
    resumeId: string;
    resumeVariantId?: string;
    resume: { sha256: string; artifact?: { revision: string } };
  },
) {
  const selections = await tx.applicationDocumentSelection.findMany({
    where: { userId, jobId, current: true, question: { current: true } },
  });
  for (const selected of selections) {
    await verifyDocumentBinding(tx, artifacts, userId, selected);
    if (
      selected.resumeId !== resume.resumeId ||
      selected.variantId !== (resume.resumeVariantId ?? null) ||
      selected.pdfSha256 !== resume.resume.sha256 ||
      selected.artifactRevision !== resume.resume.artifact?.revision
    )
      throw conflict("The checkpoint PDF differs from the human-selected resume artifact.");
  }
}
