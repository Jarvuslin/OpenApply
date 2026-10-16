import {
  fitAssessmentSchema,
  fitContextSchema,
  scoreAssessmentInputSchema,
  scoreContextInputSchema,
} from "@openapply/contracts/scoring";
import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { ScoringService } from "./scoring.service";

const scoringService = container.resolve(ScoringService);

export const scoringController = new Elysia({
  prefix: "/score-fit",
  detail: { tags: ["Scoring"] },
})
  .use(authGuard)
  .post("/context", ({ user, body }) => scoringService.context(user.id, body), {
    body: scoreContextInputSchema,
    response: fitContextSchema,
    beforeHandle: rateLimit(RATE_LIMITS.applyQueue),
    detail: {
      summary: "Read original resume and complete job description for local-agent assessment",
    },
  })
  .post("/", ({ user, body }) => scoringService.scoreJobFit(user.id, body), {
    body: scoreAssessmentInputSchema,
    response: fitAssessmentSchema,
    beforeHandle: rateLimit(RATE_LIMITS.applyQueue),
    detail: {
      summary: "Score job fit",
      description:
        "Validates every local-agent assessment against original source spans, computes fixed score components, and persists the assessment and job score together. Existing assessments with the same input basis are immutable.",
    },
  });
