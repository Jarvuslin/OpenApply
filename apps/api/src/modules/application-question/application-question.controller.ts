import {
  answerApplicationQuestionSchema,
  applicationQuestionSchema,
  jobQuestionParams,
  jobQuestionsSchema,
  needsYouCountSchema,
  needsYouListSchema,
  needsYouQuerySchema,
  questionObservationSchema,
} from "@openapply/contracts/application-question";
import { idParam } from "@openapply/contracts/shared";
import { needsYouChannel } from "@openapply/contracts/sse";
import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { sseStream } from "@/common/sse";
import { ApplicationQuestionService } from "./application-question.service";

const service = container.resolve(ApplicationQuestionService);
const read = rateLimit(RATE_LIMITS.questionRead);
const mutate = rateLimit(RATE_LIMITS.questionMutation);
export const applicationQuestionController = new Elysia({
  detail: { tags: ["Application questions"] },
})
  .use(authGuard)
  .get("/jobs/:slug/questions", ({ user, params }) => service.get(user.id, params.slug), {
    params: jobQuestionParams,
    response: jobQuestionsSchema,
    beforeHandle: read,
    detail: { summary: "Read owned observed application question revisions" },
  })
  .put(
    "/jobs/:slug/questions/observations",
    ({ user, params, body, authKind }) => service.observe(user.id, params.slug, body, authKind),
    {
      params: jobQuestionParams,
      body: questionObservationSchema,
      response: jobQuestionsSchema,
      beforeHandle: mutate,
      detail: { summary: "Store bounded observed form definitions without model execution" },
    },
  )
  .post(
    "/application-questions/:id/answers",
    ({ user, params, body, authKind }) => service.answer(user.id, params.id, body, authKind),
    {
      params: idParam,
      body: answerApplicationQuestionSchema,
      response: applicationQuestionSchema,
      beforeHandle: mutate,
      detail: { summary: "Confirm an exact question revision as a signed-in person" },
    },
  )
  .get("/needs-you", ({ user, query }) => service.list(user.id, query), {
    query: needsYouQuerySchema,
    response: needsYouListSchema,
    beforeHandle: read,
    detail: { summary: "Page through application and operational blockers" },
  })
  .get("/needs-you/count", ({ user }) => service.count(user.id), {
    response: needsYouCountSchema,
    beforeHandle: read,
    detail: { summary: "Count every unresolved application and operational question" },
  })
  .get(
    "/needs-you/events",
    ({ user, headers }) => sseStream(needsYouChannel, { userId: user.id }, headers),
    { detail: { summary: "Stream owned attention changes" } },
  );
