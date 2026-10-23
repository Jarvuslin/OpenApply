import {
  correctResumeEvidenceSchema,
  createResumeEvidenceSchema,
  resumeEvidenceListSchema,
  resumeEvidenceQuerySchema,
  resumeEvidenceSchema,
  retractResumeEvidenceQuerySchema,
} from "@openapply/contracts/resume-evidence";
import { idParam } from "@openapply/contracts/shared";
import { Elysia } from "elysia";
import { z } from "zod/v4";
import { container } from "@/common/di/container";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { ResumeEvidenceService } from "./resume-evidence.service";

const service = container.resolve(ResumeEvidenceService);
const evidenceParams = idParam.extend({ evidenceId: z.uuid() });

export const resumeEvidenceController = new Elysia({
  prefix: "/resumes",
  detail: { tags: ["Resumes"] },
})
  .use(authGuard)
  .get("/:id/evidence", ({ user, params, query }) => service.list(user.id, params.id, query), {
    params: idParam,
    query: resumeEvidenceQuerySchema,
    response: resumeEvidenceListSchema,
    beforeHandle: rateLimit(RATE_LIMITS.evidenceRead),
    detail: { summary: "List reusable owned resume evidence and optional unanswered details" },
  })
  .post("/:id/evidence", ({ user, params, body }) => service.create(user.id, params.id, body), {
    params: idParam,
    body: createResumeEvidenceSchema,
    response: resumeEvidenceSchema,
    beforeHandle: rateLimit(RATE_LIMITS.evidenceMutation),
    detail: {
      summary: "Record source-verified evidence separately from original resume and fit scores",
    },
  })
  .patch(
    "/:id/evidence/:evidenceId",
    ({ user, params, body }) => service.correct(user.id, params.id, params.evidenceId, body),
    {
      params: evidenceParams,
      body: correctResumeEvidenceSchema,
      response: resumeEvidenceSchema,
      beforeHandle: rateLimit(RATE_LIMITS.evidenceMutation),
      detail: { summary: "Correct or restore owned evidence using its current revision" },
    },
  )
  .delete(
    "/:id/evidence/:evidenceId",
    ({ user, params, query }) =>
      service.retract(user.id, params.id, params.evidenceId, query.revision),
    {
      params: evidenceParams,
      query: retractResumeEvidenceQuerySchema,
      response: resumeEvidenceSchema,
      beforeHandle: rateLimit(RATE_LIMITS.evidenceMutation),
      detail: {
        summary:
          "Retract evidence from future rewrites while preserving historical artifact snapshots",
      },
    },
  );
