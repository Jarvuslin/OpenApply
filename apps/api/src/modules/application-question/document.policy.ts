import type { QuestionDefinition } from "@openapply/contracts/application-question";
import { z } from "zod/v4";
import { isHumanAuthorship } from "@/common/auth/human-actor";
import type { ApplicationDocumentSelection, Prisma } from "@/generated/prisma/client";
import { sha256 } from "@/modules/resume/resume-artifact-store";

export const documentSourceSchema = z.object({
  resumeVersion: z.number().int(),
  sourceFilename: z.string().nullable(),
  sourceSha256: z.string().nullable(),
  sourceContentSha256: z.string().nullable(),
  variantContentSha256: z.string().nullable(),
  variantUpdatedAt: z.string().nullable(),
  jobUrl: z.string(),
});

export function documentPurpose(definition: QuestionDefinition, fieldKey: string) {
  const field = definition.fields.find((field) => field.key === fieldKey);
  if (field?.type !== "file") return "unsupported" as const;
  const normalize = (text: string) =>
    text
      .normalize("NFC")
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, " ")
      .replace(/[:*]+$/g, "")
      .trim();
  const labels = [field.label, definition.fields.length === 1 ? definition.prompt : undefined]
    .filter((value): value is string => !!value)
    .map(normalize);
  if (labels.some((label) => /cover|letter|portfolio|transcript|certificate/.test(label)))
    return "unsupported" as const;
  const allowed = new Set([
    "resume",
    "resume pdf",
    "resume pdf",
    "resume",
    "cv",
    "resume/cv",
    "resume / cv",
    "resume / cv",
    "curriculum vitae",
    "upload resume",
    "upload your resume",
    "attach resume",
    "attach your resume",
    "resume attachment",
  ]);
  return labels.some((label) => allowed.has(label))
    ? ("resume" as const)
    : ("unsupported" as const);
}

export async function selectionDatabaseProblem(
  tx: Prisma.TransactionClient,
  selection: ApplicationDocumentSelection,
  userId: string,
  jobUrl: string,
) {
  if (selection.invalidatedAt)
    return selection.invalidReason ?? "The selected artifact needs review.";
  if (!selection.current || selection.userId !== userId || !isHumanAuthorship(selection.authorship))
    return "This document selection is no longer current.";
  const source = documentSourceSchema.safeParse(selection.sourceSnapshot);
  if (!source.success || source.data.jobUrl !== jobUrl)
    return "The selected job or source provenance changed.";
  const resume = await tx.resume.findFirst({ where: { id: selection.resumeId, userId } });
  if (!resume) return "The selected resume was deleted or is no longer owned.";
  if (
    resume.version !== source.data.resumeVersion ||
    resume.sourceFilename !== source.data.sourceFilename ||
    (resume.content === null ? null : sha256(resume.content)) !== source.data.sourceContentSha256
  )
    return "The original resume changed; select a newly reviewed artifact.";
  if (selection.variantId) {
    const variant = await tx.resumeVariant.findFirst({
      where: { id: selection.variantId, resumeId: resume.id },
    });
    if (
      !variant ||
      sha256(variant.content) !== source.data.variantContentSha256 ||
      variant.updatedAt.toISOString() !== source.data.variantUpdatedAt
    )
      return "The selected variant changed or was deleted.";
  }
  return null;
}

export async function resolvedDocumentFields(
  tx: Prisma.TransactionClient,
  userId: string,
  jobId: string,
) {
  const selections = await tx.applicationDocumentSelection.findMany({
    where: { userId, jobId, current: true },
  });
  const result = new Map<string, Set<string>>();
  if (!selections.length) return result;
  const job = await tx.job.findFirst({ where: { id: jobId, campaign: { userId } } });
  if (!job) return result;
  for (const selection of selections) {
    const question = await tx.applicationQuestion.findFirst({
      where: { id: selection.questionId, userId, jobId, current: true },
    });
    if (
      !question ||
      question.revision !== selection.questionRevision ||
      question.definitionHash !== selection.definitionHash ||
      (await selectionDatabaseProblem(tx, selection, userId, job.url))
    )
      continue;
    const fields = result.get(question.id) ?? new Set<string>();
    fields.add(selection.fieldKey);
    result.set(question.id, fields);
  }
  return result;
}
