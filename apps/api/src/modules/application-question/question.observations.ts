import {
  type QuestionDefinition,
  questionDefinitionSchema,
} from "@openapply/contracts/application-question";
import { badRequest, conflict, notFound } from "@/common/errors";
import type {
  Prisma,
  QuestionAuthorship,
  QuestionCoverage,
  QuestionSource,
} from "@/generated/prisma/client";
import { autoAnswerFromBank } from "@/modules/answer-bank/answer-bank.auto";
import { lockWorkUser } from "@/modules/work-queue/work-queue.admission";
import {
  assertObservationUrl,
  questionCategory,
  questionHash,
  resolvedConditions,
} from "./question.policy";
import { resumeAnsweredJob } from "./question.resume";
import { recomputeQuestionBlockers } from "./question.store";

export interface StoredObservation {
  requestId: string;
  expectedCollectionVersion: number;
  source: QuestionSource;
  sourceUrl: string;
  coverage: QuestionCoverage;
  collectorVersion: string;
  reason?: string;
  definitions: QuestionDefinition[];
}

export async function storeObservation(
  tx: Prisma.TransactionClient,
  userId: string,
  jobId: string,
  input: StoredObservation,
  authorship: QuestionAuthorship,
) {
  await lockWorkUser(tx, userId);
  const job = await tx.job.findFirst({ where: { id: jobId, campaign: { userId } } });
  if (!job) throw notFound("Job not found");
  assertObservationUrl(job.url, input.sourceUrl);
  const payloadHash = questionHash({ jobId, input, authorship });
  const previous = await tx.jobQuestionCollection.findUnique({
    where: { userId_requestId: { userId, requestId: input.requestId } },
  });
  if (previous) {
    if (previous.payloadHash !== payloadHash)
      throw conflict("Collection request ID was reused with different observations.");
    return previous;
  }
  const latest = await tx.jobQuestionCollection.findFirst({
    where: { jobId, userId },
    orderBy: { version: "desc" },
  });
  if ((latest?.version ?? 0) !== input.expectedCollectionVersion)
    throw conflict("Question collection changed; load the latest version before collecting again.");
  if (
    new Set(input.definitions.map((definition) => definition.stableKey)).size !==
    input.definitions.length
  )
    throw badRequest("Question identities must be unique.");
  const allFields = input.definitions.flatMap((definition) =>
    definition.fields.map((field) => field.key),
  );
  if (new Set(allFields).size !== allFields.length)
    throw badRequest("A field cannot belong to multiple question groups.");
  let coverage = input.coverage;
  let reason = input.reason ?? null;
  if (coverage === "complete" && !input.definitions.length) {
    coverage = "partial";
    reason = "An empty observation cannot establish a complete application form.";
  }
  if (coverage === "complete" && !resolvedConditions(input.definitions)) {
    coverage = "partial";
    reason =
      "A conditional field refers to a missing or circular parent; further browser inspection is required.";
  }
  if (
    coverage === "complete" &&
    input.definitions.some(
      (definition) =>
        definition.required === "unknown" ||
        definition.visibility === "unknown" ||
        definition.condition.state === "unknown" ||
        definition.fields.some(
          (field) =>
            field.type === "unknown" ||
            (["single_choice", "multi_choice"].includes(field.type) && !field.options.length) ||
            field.options.some((option) => option.freeText && option.freeText !== "none"),
        ),
    )
  ) {
    coverage = "partial";
    reason =
      "Unknown requiredness, visibility, conditions or controls require further browser inspection.";
  }
  const collection = await tx.jobQuestionCollection.create({
    data: {
      userId,
      jobId,
      requestId: input.requestId,
      payloadHash,
      version: (latest?.version ?? 0) + 1,
      source: input.source,
      sourceUrl: input.sourceUrl,
      coverage,
      collectorVersion: input.collectorVersion,
      authorship,
      reason,
      definitionIds: [],
    },
  });
  const current = await tx.applicationQuestion.findMany({
    where: { userId, jobId, current: true },
    include: { collection: true },
  });
  const ids: string[] = [];
  for (const observed of input.definitions) {
    const fieldKeys = observed.fields
      .map((field) => field.key)
      .sort()
      .join("|");
    const matches = current.filter(
      (row) =>
        questionDefinitionSchema
          .parse(row.definition)
          .fields.map((field) => field.key)
          .sort()
          .join("|") === fieldKeys,
    );
    if (matches.length > 1)
      throw conflict("Existing question field identities conflict; review before recollecting.");
    const legacy = current.filter((row) => {
      if (row.collection.source !== "legacy") return false;
      const prior = questionDefinitionSchema.parse(row.definition);
      return (
        prior.prompt === observed.prompt &&
        JSON.stringify(
          prior.fields.flatMap((field) => field.options.map((option) => option.label)),
        ) ===
          JSON.stringify(
            observed.fields.flatMap((field) => field.options.map((option) => option.label)),
          )
      );
    });
    const existing =
      current.find((row) => row.stableKey === observed.stableKey) ?? matches[0] ?? legacy[0];
    const definition = { ...observed, stableKey: existing?.stableKey ?? observed.stableKey };
    const definitionHash = questionHash(definition);
    if (existing?.definitionHash === definitionHash) {
      ids.push(existing.id);
      continue;
    }
    const lastRevision =
      existing ??
      (await tx.applicationQuestion.findFirst({
        where: { userId, jobId, stableKey: definition.stableKey },
        orderBy: { revision: "desc" },
      }));
    if (existing)
      await tx.applicationQuestion.update({
        where: { id: existing.id },
        data: { current: false, blocking: false },
      });
    const question = await tx.applicationQuestion.create({
      data: {
        userId,
        jobId,
        collectionId: collection.id,
        stableKey: definition.stableKey,
        revision: (lastRevision?.revision ?? 0) + 1,
        definitionHash,
        definition,
        category: questionCategory(definition),
        required: definition.required,
        visibility: definition.visibility,
        current: true,
        blocking: true,
      },
    });
    ids.push(question.id);
    await autoAnswerFromBank(tx, userId, {
      id: question.id,
      jobId,
      definition,
      category: question.category,
    });
    const replaced = new Set([...(existing ? [existing.id] : []), ...legacy.map((row) => row.id)]);
    for (const priorId of replaced) {
      await tx.applicationQuestion.update({
        where: { id: priorId },
        data: { current: false, blocking: false },
      });
      await tx.pilotQuestion.updateMany({
        where: { userId, applicationQuestionId: priorId },
        data: { applicationQuestionId: question.id },
      });
    }
    // Only exact prompt/options matches retire an operational copy; a paraphrase is not evidence of identity.
    const operational = await tx.pilotQuestion.findMany({
      where: {
        userId,
        subjectType: "job",
        subjectId: jobId,
        kind: { in: ["question", "choice"] },
        applicationQuestionId: null,
        prompt: definition.prompt,
      },
    });
    for (const prior of operational) {
      const labels = definition.fields.flatMap((field) =>
        field.options.map((option) => option.label),
      );
      if (JSON.stringify(prior.options) !== JSON.stringify(labels)) continue;
      await tx.pilotQuestion.update({
        where: { id: prior.id },
        data: { applicationQuestionId: question.id },
      });
    }
  }
  if (coverage === "complete")
    await tx.applicationQuestion.updateMany({
      where: { userId, jobId, current: true, id: { notIn: ids } },
      data: { current: false, blocking: false },
    });
  await tx.jobQuestionCollection.update({
    where: { id: collection.id },
    data: { definitionIds: ids },
  });
  const retained = await tx.applicationQuestion.findMany({
    where: { userId, jobId, current: true },
  });
  const retainedKeys = retained.flatMap((row) =>
    questionDefinitionSchema.parse(row.definition).fields.map((field) => field.key),
  );
  if (new Set(retainedKeys).size !== retainedKeys.length)
    throw conflict(
      "Partial observations conflict with retained field identities. Collect the complete group before replacing it.",
    );
  const semanticChange =
    latest?.coverage !== coverage ||
    retained.length !== current.length ||
    retained.some((row) => !current.some((prior) => prior.id === row.id));
  if (semanticChange)
    await tx.job.update({
      where: { id: jobId },
      data: { updatedAt: new Date(Math.max(Date.now(), job.updatedAt.getTime() + 1)) },
    });
  await recomputeQuestionBlockers(tx, userId, jobId);
  if (coverage === "complete") await resumeAnsweredJob(tx, userId, jobId);
  return collection;
}
