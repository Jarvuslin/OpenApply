import {
  submissionAttemptResponseSchema,
  submissionBeginInputSchema,
  submissionBeginResponseSchema,
  submissionCheckpointInputSchema,
  submissionReceiptInputSchema,
  submissionWorkerCheckResponseSchema,
  submissionWorkerResultSchema,
} from "@openapply/contracts/submission";
import { Elysia } from "elysia";
import { z } from "zod/v4";
import { container } from "@/common/di/container";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { campaignJobParams } from "@/modules/campaign/jobs/job.schema";
import { SubmissionAttemptService } from "./submission-attempt.service";

const attempts = container.resolve(SubmissionAttemptService);
export const submissionAttemptController = new Elysia({
  prefix: "/:id/jobs/:key",
  detail: { tags: ["Campaigns"] },
})
  .use(authGuard)
  .post(
    "/worker-result-check",
    ({ user, params, body }) => attempts.checkWorkerResult(user.id, params.id, params.key, body),
    {
      params: campaignJobParams,
      body: submissionWorkerResultSchema,
      response: submissionWorkerCheckResponseSchema,
      beforeHandle: rateLimit(RATE_LIMITS.applyQueue),
      detail: {
        summary:
          "Validate worker output against durable submission state without recording an application",
      },
    },
  )
  .get("/submission-attempt", ({ user, params }) => attempts.read(user.id, params.id, params.key), {
    params: campaignJobParams,
    response: submissionAttemptResponseSchema,
    detail: { summary: "Read the durable submission checkpoint and receipt for recovery" },
  })
  .post(
    "/submission-checkpoint",
    ({ user, params, body }) => attempts.checkpoint(user.id, params.id, params.key, body),
    {
      params: campaignJobParams,
      body: submissionCheckpointInputSchema,
      response: submissionAttemptResponseSchema,
      beforeHandle: rateLimit(RATE_LIMITS.applyQueue),
      detail: {
        summary: "Save reviewed answers and exact PDF before requesting Submit permission",
      },
    },
  )
  .post(
    "/submission-begin",
    ({ user, params, body, headers }) =>
      attempts.begin(
        user.id,
        params.id,
        params.key,
        body.checkpointId,
        headers["x-openapply-work-item"],
        headers["x-openapply-work-lease"],
      ),
    {
      params: campaignJobParams,
      body: submissionBeginInputSchema,
      response: submissionBeginResponseSchema,
      beforeHandle: rateLimit(RATE_LIMITS.applyQueue),
      detail: { summary: "Issue one Submit permission; repeats never authorize another attempt" },
    },
  )
  .post(
    "/submission-receipt",
    ({ user, params, body }) => attempts.receipt(user.id, params.id, params.key, body),
    {
      params: campaignJobParams,
      body: submissionReceiptInputSchema,
      response: submissionAttemptResponseSchema,
      beforeHandle: rateLimit(RATE_LIMITS.applyQueue),
      detail: {
        summary: "Persist an observed receipt independently before recording the application",
      },
    },
  )
  .get(
    "/submission-checkpoints/:checkpointId/pdf",
    ({ user, params }) => attempts.pdf(user.id, params.id, params.key, params.checkpointId),
    {
      params: campaignJobParams.extend({ checkpointId: z.uuid() }),
      detail: { summary: "Read the exact retained PDF from an owned checkpoint" },
    },
  );
