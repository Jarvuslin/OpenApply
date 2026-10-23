import { type PaginationQuery, pageSlice, paginate } from "@openapply/contracts/pagination";
import { fitContextSchema } from "@openapply/contracts/scoring";
import {
  type CreateEvaluation,
  createEvaluationSchema,
  type EvaluationResultInput,
  evaluationResultInputSchema,
} from "@openapply/contracts/scoring-evaluation";
import { singleton } from "tsyringe";
import { conflict, forbidden, notFound, unprocessable } from "@/common/errors";
import { toInputJson } from "@/common/json";
import type { AuthKind } from "@/common/middleware/auth-resolution";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { sameBasis } from "@/modules/scoring/assessment";
import { ScoringService } from "@/modules/scoring/scoring.service";
import { lockWorkUser } from "@/modules/work-queue/work-queue.admission";
import { evaluationReport } from "./evaluation.comparison";
import { evaluateEligibility } from "./evaluation.eligibility";
import { evaluationHash } from "./evaluation.hash";
import { validateEvaluationResult } from "./evaluation.result";
import { caseView, resultView, runView } from "./evaluation.store";

@singleton()
export class ScoringEvaluationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly scoring: ScoringService,
  ) {}

  async create(userId: string, raw: CreateEvaluation, authKind: AuthKind) {
    const input = createEvaluationSchema.parse(raw);
    if (input.cases.some((row) => row.facts) && authKind !== "session_user")
      throw forbidden("Only a signed-in person can confirm country-specific evaluation facts.");
    const payloadHash = evaluationHash(input);
    return this.prisma.$transaction(
      async (tx) => {
        await lockWorkUser(tx, userId);
        const prior = await tx.scoringEvaluationRun.findUnique({
          where: { userId_requestId: { userId, requestId: input.requestId } },
        });
        if (prior) {
          if (prior.payloadHash !== payloadHash)
            throw conflict("Evaluation request ID was reused with different inputs.");
          return runView(prior);
        }
        const snapshots = [];
        for (const item of input.cases) {
          const job = await tx.job.findFirst({ where: { id: item.jobId, campaign: { userId } } });
          if (!job) throw notFound("Owned evaluation job not found");
          const source = await this.scoring.context(
            userId,
            { campaignId: job.campaignId, jobKey: job.key },
            tx,
          );
          if (!sameBasis(source.basis, item.expectedBasis))
            throw conflict("Evaluation source changed. Read the current original-resume context.");
          const context = fitContextSchema.parse({ ...source, cachedAssessment: null });
          if (new TextEncoder().encode(JSON.stringify(context)).byteLength > 1_000_000)
            throw unprocessable("An evaluation context exceeds the one-megabyte limit.");
          snapshots.push({
            job,
            context,
            historicalReference: source.cachedAssessment,
            eligibility: evaluateEligibility(context, item.facts ?? null),
            factsConfirmedAt: item.facts ? new Date() : null,
          });
        }
        const run = await tx.scoringEvaluationRun.create({
          data: {
            userId,
            requestId: input.requestId,
            payloadHash,
            name: input.name,
            cohort: input.cohort,
            caseCount: snapshots.length,
            escalationBand: input.escalationBand,
            policyVersion: 1,
          },
        });
        for (const [ordinal, snapshot] of snapshots.entries())
          await tx.scoringEvaluationCase.create({
            data: {
              userId,
              runId: run.id,
              ordinal,
              jobId: snapshot.job.id,
              campaignId: snapshot.job.campaignId,
              jobKey: snapshot.job.key,
              contextHash: evaluationHash(snapshot.context),
              context: toInputJson(snapshot.context),
              historicalReference: snapshot.historicalReference
                ? toInputJson(snapshot.historicalReference)
                : Prisma.DbNull,
              eligibility: toInputJson(snapshot.eligibility),
              factsConfirmedAt: snapshot.factsConfirmedAt,
            },
          });
        return runView(run);
      },
      { timeout: 30_000 },
    );
  }

  async list(userId: string, query: PaginationQuery) {
    return this.prisma.$transaction(
      async (tx) => {
        const where = { userId };
        const [rows, total] = await Promise.all([
          tx.scoringEvaluationRun.findMany({
            where,
            ...pageSlice(query),
            orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          }),
          tx.scoringEvaluationRun.count({ where }),
        ]);
        return paginate(rows.map(runView), query, total);
      },
      { isolationLevel: "RepeatableRead" },
    );
  }

  async detail(userId: string, id: string) {
    const row = await this.prisma.scoringEvaluationRun.findFirst({ where: { id, userId } });
    if (!row) throw notFound("Evaluation run not found");
    return runView(row);
  }

  async cases(userId: string, runId: string, query: PaginationQuery) {
    return this.prisma.$transaction(
      async (tx) => {
        if (!(await tx.scoringEvaluationRun.findFirst({ where: { id: runId, userId } })))
          throw notFound("Evaluation run not found");
        const where = { userId, runId };
        const [rows, total] = await Promise.all([
          tx.scoringEvaluationCase.findMany({
            where,
            ...pageSlice(query),
            orderBy: { ordinal: "asc" },
            include: { results: { orderBy: { slot: "asc" } } },
          }),
          tx.scoringEvaluationCase.count({ where }),
        ]);
        return paginate(rows.map(caseView), query, total);
      },
      { isolationLevel: "RepeatableRead" },
    );
  }

  async result(userId: string, caseId: string, raw: EvaluationResultInput) {
    const input = evaluationResultInputSchema.parse(raw);
    const payloadHash = evaluationHash({ caseId, input });
    return this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      const row = await tx.scoringEvaluationCase.findFirst({
        where: { id: caseId, userId },
        include: { results: true },
      });
      if (!row) throw notFound("Evaluation case not found");
      const prior = await tx.scoringEvaluationResult.findUnique({
        where: { userId_requestId: { userId, requestId: input.requestId } },
      });
      if (prior) {
        if (prior.payloadHash !== payloadHash)
          throw conflict("Evaluation result request ID was reused.");
        return resultView(prior);
      }
      if (row.results.some((result) => result.slot === input.slot))
        throw conflict("This evaluation result slot is immutable and already recorded.");
      const validated = validateEvaluationResult(caseView(row), input);
      const saved = await tx.scoringEvaluationResult.create({
        data: {
          userId,
          caseId,
          requestId: input.requestId,
          payloadHash,
          slot: input.slot,
          origin: input.origin,
          requestedModel: input.requestedModel,
          actualModels: input.actualModels,
          modelVersion: input.modelVersion,
          status: validated.status,
          failureCode: validated.failureCode,
          judgments: input.judgments ? toInputJson(input.judgments) : Prisma.DbNull,
          assessment: validated.assessment ? toInputJson(validated.assessment) : Prisma.DbNull,
          telemetry: toInputJson(input.telemetry),
          requestIdentityHashes: input.requestIdentityHashes,
          validationReason: validated.validationReason,
        },
      });
      return resultView(saved);
    });
  }

  async report(userId: string, runId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const run = await tx.scoringEvaluationRun.findFirst({ where: { id: runId, userId } });
        if (!run) throw notFound("Evaluation run not found");
        const rows = await tx.scoringEvaluationCase.findMany({
          where: { runId, userId },
          orderBy: { ordinal: "asc" },
          include: { results: { orderBy: { slot: "asc" } } },
        });
        return evaluationReport(runView(run), rows.map(caseView));
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
}
