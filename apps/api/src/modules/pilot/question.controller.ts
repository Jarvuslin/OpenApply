import { checkpointDecisionSchema } from "@openapply/contracts/checkpoint-approval";
import {
  answerPilotQuestionSchema,
  createPilotQuestionSchema,
  pilotQuestionListSchema,
  pilotQuestionSchema,
  pilotQuestionsQuerySchema,
} from "@openapply/contracts/pilot";
import { idParam } from "@openapply/contracts/shared";
import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { PilotCheckpointApprovalService } from "./checkpoint-approval.service";
import { PilotQuestionService } from "./question.service";

const questions = container.resolve(PilotQuestionService);
const approvals = container.resolve(PilotCheckpointApprovalService);
const limitMutation = rateLimit(RATE_LIMITS.pilotMutation);

export const pilotQuestionsController = new Elysia({
  prefix: "/pilot",
  detail: { tags: ["Pilot"] },
})
  .use(authGuard)
  .get("/questions/:id/approval", ({ user, params }) => approvals.read(user.id, params.id), {
    params: idParam,
    response: pilotQuestionSchema,
    beforeHandle: rateLimit(RATE_LIMITS.workQueueRead),
    detail: { summary: "Read exact-checkpoint approval details" },
  })
  .post(
    "/questions/:id/decision",
    ({ user, params, body, authKind }) => approvals.decide(user.id, params.id, body, authKind),
    {
      params: idParam,
      body: checkpointDecisionSchema,
      response: pilotQuestionSchema,
      beforeHandle: limitMutation,
      detail: { summary: "Confirm the exact reviewed checkpoint" },
    },
  )
  .post("/questions", ({ user, body }) => questions.createQuestion(user.id, body), {
    body: createPilotQuestionSchema,
    beforeHandle: limitMutation,
    response: pilotQuestionSchema,
    detail: {
      summary: "Create a question",
      description: "Opens a question/choice/2fa/approval question and notifies subscribers.",
    },
  })
  .get("/questions", ({ user, query }) => questions.listQuestions(user.id, query.status), {
    query: pilotQuestionsQuerySchema,
    response: pilotQuestionListSchema,
    detail: {
      summary: "List questions",
      description: "Returns the profile's questions, optionally filtered by status.",
    },
  })
  .post(
    "/questions/:id/answer",
    ({ user, params, body }) => questions.answerQuestion(user.id, params.id, body),
    {
      params: idParam,
      body: answerPilotQuestionSchema,
      beforeHandle: limitMutation,
      response: pilotQuestionSchema,
      detail: {
        summary: "Answer a question",
        description: "Records the answer, marks the question answered, and notifies subscribers.",
      },
    },
  );
