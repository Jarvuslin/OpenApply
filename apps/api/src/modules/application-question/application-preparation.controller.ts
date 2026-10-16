import {
  applicationPreparationSchema,
  documentSelectionSchema,
  preparationQuerySchema,
  preparationResultInputSchema,
  preparationResultSchema,
  selectQuestionDocumentSchema,
} from "@openapply/contracts/application-preparation";
import { jobQuestionParams } from "@openapply/contracts/application-question";
import { idParam } from "@openapply/contracts/shared";
import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { ApplicationPreparationService } from "./application-preparation.service";

const service = container.resolve(ApplicationPreparationService);
const read = rateLimit(RATE_LIMITS.questionRead);
const mutate = rateLimit(RATE_LIMITS.questionMutation);
export const applicationPreparationController = new Elysia({
  detail: { tags: ["Application preparation"] },
})
  .use(authGuard)
  .post(
    "/application-questions/:id/document-selection",
    ({ user, params, body, authKind }) =>
      service.selectDocument(user.id, params.id, body, authKind),
    {
      params: idParam,
      body: selectQuestionDocumentSchema,
      response: documentSelectionSchema,
      beforeHandle: mutate,
      detail: {
        summary: "Select an exact owned canonical resume PDF for the current upload field",
      },
    },
  )
  .get(
    "/jobs/:slug/preparation",
    ({ user, params, query, headers }) =>
      service.get(
        user.id,
        params.slug,
        query,
        headers["x-openapply-work-item"],
        headers["x-openapply-work-lease"],
      ),
    {
      params: jobQuestionParams,
      query: preparationQuerySchema,
      response: applicationPreparationSchema,
      beforeHandle: read,
      detail: { summary: "Read bounded preparation inputs without granting submission permission" },
    },
  )
  .get("/application-documents/:id/pdf", ({ user, params }) => service.file(user.id, params.id), {
    params: idParam,
    beforeHandle: read,
    detail: { summary: "Download exact verified PDF bytes for a current owned document selection" },
  })
  .post(
    "/jobs/:slug/preparation/results",
    ({ user, params, body, authKind, headers }) =>
      service.result(
        user.id,
        params.slug,
        body,
        authKind,
        headers["x-openapply-work-item"],
        headers["x-openapply-work-lease"],
      ),
    {
      params: jobQuestionParams,
      body: preparationResultInputSchema,
      response: preparationResultSchema,
      beforeHandle: mutate,
      detail: {
        summary:
          "Preserve observed preparation readback without confirming facts or allowing submission",
      },
    },
  );
