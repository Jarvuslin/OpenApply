import { jobQuestionsSchema } from "@openapply/contracts/application-question";
import {
  intakePreparationContextSchema,
  intakePreparationFitSchema,
  intakePreparationPostingSchema,
  intakePreparationQuestionsSchema,
} from "@openapply/contracts/intake-preparation";
import { fitAssessmentSchema } from "@openapply/contracts/scoring";
import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { okResponseSchema } from "@/types/response";
import { IntakePreparationService } from "./intake-preparation.service";

const service = container.resolve(IntakePreparationService);
const runtime = rateLimit(RATE_LIMITS.workQueueRuntime);
// These routes accept only the live preparation capability, never an account session or PAT.
export const intakePreparationController = new Elysia({
  prefix: "/intake-preparation",
  detail: { tags: ["Intake preparation"] },
})
  .get("/context", ({ headers }) => service.context(headers.authorization), {
    response: intakePreparationContextSchema,
    beforeHandle: runtime,
    detail: { summary: "Read the exact preparation scope and original source" },
  })
  .post("/posting", ({ headers, body }) => service.posting(headers.authorization, body), {
    body: intakePreparationPostingSchema,
    response: okResponseSchema,
    beforeHandle: runtime,
    detail: { summary: "Save the exact intake job description without authorizing application" },
  })
  .post("/fit", ({ headers, body }) => service.fit(headers.authorization, body), {
    body: intakePreparationFitSchema,
    response: fitAssessmentSchema,
    beforeHandle: runtime,
    detail: { summary: "Validate source-grounded fit judgments for this preparation only" },
  })
  .post("/questions", ({ headers, body }) => service.observe(headers.authorization, body), {
    body: intakePreparationQuestionsSchema,
    response: jobQuestionsSchema,
    beforeHandle: runtime,
    detail: { summary: "Save observed questions for this preparation only" },
  });
