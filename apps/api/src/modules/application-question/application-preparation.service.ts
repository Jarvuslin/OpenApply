import {
  type PreparationQuery,
  type PreparationResultInput,
  preparationResultInputSchema,
  preparationResultSchema,
  type SelectQuestionDocument,
  selectQuestionDocumentSchema,
} from "@openapply/contracts/application-preparation";
import { questionDefinitionSchema } from "@openapply/contracts/application-question";
import { needsYouChannel, workQueueChannel } from "@openapply/contracts/sse";
import { singleton } from "tsyringe";
import { assertHumanActor, type HumanActor } from "@/common/auth/human-actor";
import { conflict, notFound } from "@/common/errors";
import { toInputJson } from "@/common/json";
import type { AuthKind } from "@/common/middleware/auth-resolution";
import { publish } from "@/common/sse";
import { PrismaClient } from "@/generated/prisma/client";
import { ResumeArtifactService } from "@/modules/resume/resume-artifact.service";
import { sha256 } from "@/modules/resume/resume-artifact-store";
import { lockWorkUser } from "@/modules/work-queue/work-queue.admission";
import { documentPurpose } from "./document.policy";
import {
  documentSelectionView,
  verifyDocumentBinding,
  verifyOwnedArtifact,
} from "./document.store";
import { assertOmittedField } from "./preparation.policy";
import { preparationJob, preparationLease, preparationManifest } from "./preparation.store";
import { applicableQuestion, assertObservationUrl } from "./question.policy";
import { resumeAnsweredJob } from "./question.resume";
import { recomputeQuestionBlockers } from "./question.store";
import { sameAnswerValues } from "./question.values";

@singleton()
export class ApplicationPreparationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly artifacts: ResumeArtifactService,
  ) {}

  async selectDocument(
    userId: string,
    questionId: string,
    raw: SelectQuestionDocument,
    actor: HumanActor,
  ) {
    const input = selectQuestionDocumentSchema.parse(raw);
    const saved = await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      const authorship = await assertHumanActor(tx, userId, actor);
      const job = await preparationJob(tx, userId, input.jobId);
      const question = await tx.applicationQuestion.findFirst({
        where: { id: questionId, userId, jobId: job.id },
      });
      if (!question) throw notFound("Owned application question not found");
      const payloadHash = sha256({ questionId, input });
      const prior = await tx.applicationDocumentSelection.findUnique({
        where: { userId_requestId: { userId, requestId: input.requestId } },
      });
      if (prior) {
        if (prior.payloadHash !== payloadHash)
          throw conflict("Document selection request ID was reused.");
        await verifyDocumentBinding(tx, this.artifacts, userId, prior);
        return prior;
      }
      const collection = await tx.jobQuestionCollection.findFirst({
        where: { userId, jobId: job.id },
        orderBy: { version: "desc" },
      });
      if (
        !question.current ||
        question.revision !== input.expectedRevision ||
        question.definitionHash !== input.expectedDefinitionHash ||
        collection?.version !== input.expectedCollectionVersion
      )
        throw conflict(
          "The form changed; review its current question revision before selecting a file.",
        );
      if (
        documentPurpose(questionDefinitionSchema.parse(question.definition), input.fieldKey) !==
        "resume"
      )
        throw conflict("This field does not explicitly identify a supported resume upload.");
      const previous = await tx.applicationDocumentSelection.findFirst({
        where: { userId, questionId, fieldKey: input.fieldKey, current: true },
      });
      if ((previous?.id ?? null) !== input.expectedSelectionId)
        throw conflict("The selected document changed; reload before replacing it.");
      const verified = await verifyOwnedArtifact(tx, this.artifacts, userId, job.url, input);
      if (previous)
        await tx.applicationDocumentSelection.update({
          where: { id: previous.id },
          data: { current: false },
        });
      const row = await tx.applicationDocumentSelection.create({
        data: {
          userId,
          jobId: job.id,
          questionId,
          fieldKey: input.fieldKey,
          questionRevision: question.revision,
          definitionHash: question.definitionHash,
          requestId: input.requestId,
          payloadHash,
          current: true,
          resumeId: input.resumeId,
          variantId: input.variantId ?? null,
          artifactRevision: verified.artifact.revision,
          pdfSha256: verified.artifact.pdfSha256,
          sizeBytes: verified.artifact.sizeBytes,
          sourceSnapshot: verified.source,
          authorship,
          confirmedAt: new Date(),
        },
      });
      if (
        previous?.pdfSha256 !== row.pdfSha256 ||
        previous?.artifactRevision !== row.artifactRevision
      )
        await tx.job.update({
          where: { id: job.id },
          data: { updatedAt: new Date(Math.max(Date.now(), job.updatedAt.getTime() + 1)) },
        });
      await recomputeQuestionBlockers(tx, userId, job.id);
      await resumeAnsweredJob(tx, userId, job.id);
      return row;
    });
    publish(needsYouChannel, { userId }, { type: "needs-you.changed", jobId: input.jobId });
    publish(workQueueChannel, { userId }, { type: "work-queue.changed" });
    return documentSelectionView(saved, null);
  }

  async get(
    userId: string,
    jobId: string,
    query: PreparationQuery = { mode: "preview" },
    workItemId?: string,
    leaseToken?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      return preparationManifest(tx, this.artifacts, userId, jobId, query, workItemId, leaseToken);
    });
  }

  async file(userId: string, selectionId: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      const selection = await tx.applicationDocumentSelection.findFirst({
        where: { id: selectionId, userId },
      });
      if (!selection) throw notFound("Owned document selection not found");
      await preparationJob(tx, userId, selection.jobId);
      await verifyDocumentBinding(tx, this.artifacts, userId, selection);
      return this.artifacts.file(
        userId,
        selection.resumeId,
        selection.variantId ?? undefined,
        selection.artifactRevision,
        "pdf",
      );
    });
  }

  async result(
    userId: string,
    jobId: string,
    raw: PreparationResultInput,
    authorship: AuthKind,
    workItemId?: string,
    leaseToken?: string,
  ) {
    const input = preparationResultInputSchema.parse(raw);
    const row = await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      const job = await preparationJob(tx, userId, jobId);
      await preparationLease(tx, userId, jobId, input.mode, workItemId, leaseToken);
      const payloadHash = sha256({ jobId, input, authorship });
      const previous = await tx.applicationPreparationResult.findUnique({
        where: { userId_requestId: { userId, requestId: input.requestId } },
      });
      if (previous) {
        if (previous.payloadHash !== payloadHash)
          throw conflict("Preparation evidence request ID was reused.");
        return previous;
      }
      const manifest = await preparationManifest(
        tx,
        this.artifacts,
        userId,
        jobId,
        { mode: input.mode },
        workItemId,
        leaseToken,
      );
      if (
        manifest.manifestHash !== input.manifestHash ||
        manifest.collectionVersion !== input.expectedCollectionVersion
      )
        throw conflict(
          "Form definitions, answers, or selected document changed during preparation.",
        );
      assertObservationUrl(job.url, input.sourceUrl);
      const seen = new Set<string>();
      for (const field of input.fields) {
        const key = `${field.questionId}:${field.fieldKey}`;
        if (seen.has(key)) throw conflict("Preparation evidence repeats a field.");
        seen.add(key);
        const question = manifest.questions.find((question) => question.id === field.questionId);
        const definition = question?.definition.fields.find(
          (candidate) => candidate.key === field.fieldKey,
        );
        if (!question || !definition)
          throw conflict("Preparation evidence contains a field outside the current form.");
        if (field.status === "omitted")
          assertOmittedField(question, field, manifest.documentFields);
        if (field.status === "verified") {
          if (definition.type === "file") {
            const selected = manifest.documentFields.find(
              (candidate) =>
                candidate.questionId === question.id && candidate.fieldKey === field.fieldKey,
            )?.selection;
            if (
              !selected?.available ||
              field.pdfSha256 !== selected.pdfSha256 ||
              field.value !== undefined
            )
              throw conflict("File readback does not identify the selected verified PDF.");
          } else {
            const answer = question.answer?.values.find(
              (value) => value.fieldKey === field.fieldKey,
            );
            if (
              !answer ||
              !sameAnswerValues([answer], [{ fieldKey: field.fieldKey, value: field.value }]) ||
              field.pdfSha256 !== undefined
            )
              throw conflict("Readback differs from the exact human-confirmed field answer.");
          }
        }
      }
      if (
        input.status === "filled" &&
        (!input.fields.length ||
          input.fields.some((field) => !["verified", "omitted"].includes(field.status)) ||
          manifest.questions.some((question) => question.blocking) ||
          manifest.coverage !== "complete")
      )
        throw conflict("Incomplete or blocked preparation cannot be recorded as filled.");
      if (input.status === "filled") {
        const values = new Map(
          manifest.questions.flatMap(
            (question) =>
              question.answer?.values.map((value) => [value.fieldKey, value.value] as const) ?? [],
          ),
        );
        for (const question of manifest.questions.filter((question) =>
          applicableQuestion(question.definition, values),
        )) {
          const verified = new Set(
            input.fields
              .filter((field) => field.questionId === question.id && field.status === "verified")
              .map((field) => field.fieldKey),
          );
          const complete =
            question.definition.groupMode === "any"
              ? question.definition.fields.some((field) => verified.has(field.key))
              : question.definition.fields.every((field) => verified.has(field.key));
          if (!complete)
            throw conflict("Readback does not cover every applicable required question group.");
        }
      }
      return tx.applicationPreparationResult.create({
        data: {
          userId,
          jobId,
          requestId: input.requestId,
          payloadHash,
          collectionVersion: manifest.collectionVersion,
          manifestHash: manifest.manifestHash,
          mode: input.mode,
          status: input.status,
          authorship,
          observation: toInputJson(input),
        },
      });
    });
    return preparationResultSchema.parse({
      ...row,
      verification: "observed",
      submissionAllowed: false,
    });
  }
}
