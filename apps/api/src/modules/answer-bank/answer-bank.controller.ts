import {
  answerMatchesSchema,
  bankEntrySchema,
  bankHistorySchema,
  bankListQuerySchema,
  bankListSchema,
} from "@openapply/contracts/answer-bank";
import {
  answerMatchesInputSchema,
  reviseBankEntrySchema,
  revokeBankEntrySchema,
} from "@openapply/contracts/answer-bank-input";
import { paginationQuerySchema } from "@openapply/contracts/pagination";
import { idParam } from "@openapply/contracts/shared";
import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { AnswerBankService } from "./answer-bank.service";

const service = container.resolve(AnswerBankService);
const read = rateLimit(RATE_LIMITS.questionRead);
const mutate = rateLimit(RATE_LIMITS.questionMutation);
export const answerBankController = new Elysia({ detail: { tags: ["Saved answers"] } })
  .use(authGuard)
  .post(
    "/application-questions/:id/answer-matches",
    ({ user, params, body, authKind }) => service.matches(user.id, params.id, body, authKind),
    {
      params: idParam,
      body: answerMatchesInputSchema,
      response: answerMatchesSchema,
      beforeHandle: read,
      detail: { summary: "Find exact scoped saved answers for a human to confirm" },
    },
  )
  .get("/answer-bank", ({ user, query }) => service.list(user.id, query), {
    query: bankListQuerySchema,
    response: bankListSchema,
    beforeHandle: read,
    detail: { summary: "List owned saved answers and source availability" },
  })
  .get("/answer-bank/:id", ({ user, params, query }) => service.detail(user.id, params.id, query), {
    params: idParam,
    query: paginationQuerySchema,
    response: bankHistorySchema,
    beforeHandle: read,
    detail: { summary: "Read saved answer revision history" },
  })
  .post(
    "/answer-bank/:id/revoke",
    ({ user, params, body, authKind }) => service.revoke(user.id, params.id, body, authKind),
    {
      params: idParam,
      body: revokeBankEntrySchema,
      response: bankEntrySchema,
      beforeHandle: mutate,
      detail: { summary: "Revoke a saved answer without erasing history" },
    },
  )
  .post(
    "/answer-bank/:id/revisions",
    ({ user, params, body, authKind }) => service.revise(user.id, params.id, body, authKind),
    {
      params: idParam,
      body: reviseBankEntrySchema,
      response: bankEntrySchema,
      beforeHandle: mutate,
      detail: { summary: "Save a correction from a new human-confirmed source answer" },
    },
  );
