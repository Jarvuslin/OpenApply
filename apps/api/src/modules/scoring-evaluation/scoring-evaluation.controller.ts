import { paginationQuerySchema } from "@openapply/contracts/pagination";
import {
  evaluationCasesSchema,
  evaluationReportSchema,
  evaluationRunSchema,
  evaluationRunsSchema,
} from "@openapply/contracts/scoring-evaluation";
import { idParam } from "@openapply/contracts/shared";
import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { ScoringEvaluationService } from "./scoring-evaluation.service";

const service = container.resolve(ScoringEvaluationService);
const read = rateLimit(RATE_LIMITS.questionRead);
export const scoringEvaluationController = new Elysia({ detail: { tags: ["Scoring evaluations"] } })
  .use(authGuard)
  .get("/score-evaluations", ({ user, query }) => service.list(user.id, query), {
    query: paginationQuerySchema,
    response: evaluationRunsSchema,
    beforeHandle: read,
    detail: { summary: "List shadow scoring runs without executing models" },
  })
  .get("/score-evaluations/:id", ({ user, params }) => service.detail(user.id, params.id), {
    params: idParam,
    response: evaluationRunSchema,
    beforeHandle: read,
    detail: { summary: "Read an immutable evaluation run" },
  })
  .get(
    "/score-evaluations/:id/cases",
    ({ user, params, query }) => service.cases(user.id, params.id, query),
    {
      params: idParam,
      query: paginationQuerySchema,
      response: evaluationCasesSchema,
      beforeHandle: read,
      detail: { summary: "Read evaluation snapshots and immutable result slots" },
    },
  )
  .get("/score-evaluations/:id/report", ({ user, params }) => service.report(user.id, params.id), {
    params: idParam,
    response: evaluationReportSchema,
    beforeHandle: read,
    detail: { summary: "Compare validated replay and measured evaluation pairs separately" },
  });
