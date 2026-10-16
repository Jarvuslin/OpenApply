import type {
  CreateEvaluation,
  EvaluationCase,
  EvaluationResult,
  EvaluationResultInput,
  EvaluationRun,
} from "@openapply/contracts/scoring-evaluation";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { assessFit } from "@/modules/scoring/assessment";
import { CAMPAIGN_ID, JOB_KEY, scoringContext, scoringInput } from "@/modules/scoring/fakes";
import type { ScoringService } from "@/modules/scoring/scoring.service";
import { evaluateEligibility } from "./evaluation.eligibility";
import { evaluationHash } from "./evaluation.hash";
import { ScoringEvaluationService } from "./scoring-evaluation.service";

export function caseFixture(): EvaluationCase {
  const context = scoringContext();
  return {
    id: crypto.randomUUID(),
    runId: crypto.randomUUID(),
    ordinal: 0,
    jobId: crypto.randomUUID(),
    campaignId: CAMPAIGN_ID,
    jobKey: JOB_KEY,
    contextHash: evaluationHash(context),
    context,
    historicalReference: assessFit(context, scoringInput(context)),
    eligibility: evaluateEligibility(context, null),
    factsConfirmedAt: null,
    results: [],
  };
}
export function runFixture(row: EvaluationCase): EvaluationRun {
  return {
    id: row.runId,
    name: "Synthetic scoring fixture",
    cohort: "authored",
    caseCount: 1,
    baselineModel: "sonnet",
    candidateModel: "haiku",
    escalationBand: 5,
    policyVersion: 1,
    createdAt: new Date(),
    productionScoresUnchanged: true,
  };
}
export function resultInput(
  row: EvaluationCase,
  slot: "baseline" | "candidate" = "baseline",
): EvaluationResultInput {
  const input = scoringInput(row.context);
  return {
    requestId: crypto.randomUUID(),
    expectedContextHash: row.contextHash,
    slot,
    origin: "simulated",
    requestedModel: slot === "baseline" ? "sonnet" : "haiku",
    actualModels: [],
    modelVersion: null,
    status: "completed",
    judgments: { assessments: input.assessments, roleMatch: input.roleMatch },
    failureCode: null,
    telemetry: {
      provenance: "simulated",
      latencyMs: null,
      requests: null,
      inputTokens: null,
      cacheWriteTokens: null,
      cacheReadTokens: null,
      outputTokens: null,
    },
    requestIdentityHashes: [],
  };
}
export function resultFixture(
  row: EvaluationCase,
  slot: "baseline" | "candidate",
  changes: Partial<EvaluationResult> = {},
): EvaluationResult {
  const input = resultInput(row, slot);
  return {
    id: crypto.randomUUID(),
    caseId: row.id,
    slot,
    origin: input.origin,
    requestedModel: input.requestedModel,
    actualModels: [],
    modelVersion: null,
    status: "completed",
    failureCode: null,
    assessment: row.historicalReference,
    telemetry: input.telemetry,
    validationReason: null,
    createdAt: new Date(),
    verification: "reported",
    ...changes,
  };
}

type Row = Record<string, unknown>;
export function evaluationFixture() {
  const userId = crypto.randomUUID();
  const snapshot = caseFixture();
  const source = {
    ...structuredClone(snapshot.context),
    cachedAssessment: snapshot.historicalReference,
  };
  const production = {
    id: snapshot.jobId,
    campaignId: CAMPAIGN_ID,
    key: JOB_KEY,
    campaign: { userId },
    fitAssessment: snapshot.historicalReference,
    matchScore: 100,
    status: "approved",
  };
  const tables: { runs: Row[]; cases: Row[]; results: Row[] } = {
    runs: [],
    cases: [],
    results: [],
  };
  function matches(row: Row, where: Row): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (key === "userId_requestId") return matches(row, value as Row);
      return row[key] === value;
    });
  }
  function delegate(name: keyof typeof tables) {
    function find(
      args: { where?: Row; include?: Row; skip?: number; take?: number; orderBy?: unknown } = {},
    ) {
      let rows = tables[name].filter((row) => matches(row, args.where ?? {}));
      if (name === "cases") rows = rows.toSorted((a, b) => Number(a.ordinal) - Number(b.ordinal));
      rows = rows.slice(
        args.skip ?? 0,
        args.take === undefined ? undefined : (args.skip ?? 0) + args.take,
      );
      return rows.map((row) =>
        structuredClone({
          ...row,
          ...(args.include?.results
            ? { results: tables.results.filter((result) => result.caseId === row.id) }
            : {}),
        }),
      );
    }
    return {
      findMany: async (args: Parameters<typeof find>[0]) => find(args),
      findFirst: async (args: Parameters<typeof find>[0]) => find(args)[0] ?? null,
      findUnique: async (args: Parameters<typeof find>[0]) => find(args)[0] ?? null,
      count: async (args: Parameters<typeof find>[0]) => find(args).length,
      create: async ({ data }: { data: Row }) => {
        const row = {
          id: crypto.randomUUID(),
          createdAt: new Date(),
          ...Object.fromEntries(
            Object.entries(data).map(([key, value]) => [
              key,
              value === Prisma.DbNull ? null : structuredClone(value),
            ]),
          ),
        };
        tables[name].push(row);
        return structuredClone(row);
      },
    };
  }
  let pending = Promise.resolve();
  const raw = {
    $queryRaw: async () => [],
    scoringEvaluationRun: delegate("runs"),
    scoringEvaluationCase: delegate("cases"),
    scoringEvaluationResult: delegate("results"),
    job: {
      findFirst: async ({ where }: { where: { id: string; campaign: { userId: string } } }) =>
        where.id === production.id && where.campaign.userId === userId
          ? structuredClone(production)
          : null,
    },
    $transaction: async <T>(fn: (tx: PrismaClient) => Promise<T>) => {
      const previous = pending;
      let release = () => {};
      pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const before = structuredClone(tables);
      try {
        return await fn(raw as unknown as PrismaClient);
      } catch (error) {
        tables.runs = before.runs;
        tables.cases = before.cases;
        tables.results = before.results;
        throw error;
      } finally {
        release();
      }
    },
  };
  const db = raw as unknown as PrismaClient;
  const scoring = {
    context: async () => structuredClone(source),
    scoreJobFit: async () => {
      throw new Error("Production scoring must never run during evaluation");
    },
  } as unknown as ScoringService;
  const input: CreateEvaluation = {
    requestId: crypto.randomUUID(),
    name: "Fixture",
    cohort: "authored",
    escalationBand: 5,
    cases: [{ jobId: snapshot.jobId, expectedBasis: snapshot.context.basis }],
  };
  return {
    userId,
    snapshot,
    source,
    production,
    tables,
    input,
    service: new ScoringEvaluationService(db, scoring),
  };
}
