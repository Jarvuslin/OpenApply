import {
  addCampaignJobSchema,
  campaignJobResultSchema,
  patchCampaignJobSchema,
  rescanCampaignJobSchema,
  retryCampaignJobSchema,
} from "@openapply/contracts/campaign";
import { idParam } from "@openapply/contracts/shared";
import { submittedResumeSchema } from "@openapply/contracts/submission";
import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { badRequest } from "@/common/errors";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { SubmissionService } from "@/modules/application/submission.service";
import { submissionAttemptController } from "@/modules/application/submission-attempt.controller";
import {
  campaignJobListSchema,
  campaignJobParams,
  campaignJobReasonListSchema,
  campaignJobResultResponseSchema,
  campaignJobSchema,
  campaignJobsQuery,
} from "./job.schema";
import { CampaignJobService } from "./job.service";
import { CampaignJobQueryService } from "./job-query.service";

const svc = container.resolve(CampaignJobService);
const queries = container.resolve(CampaignJobQueryService);
const submissions = container.resolve(SubmissionService);

export const campaignJobController = new Elysia({
  name: "campaign-jobs",
  prefix: "/campaigns",
  detail: { tags: ["Campaigns"] },
})
  .use(authGuard)
  .use(submissionAttemptController)
  .get("/:id/jobs", ({ user, params, query }) => queries.listJobs(user.id, params.id, query), {
    params: idParam,
    query: campaignJobsQuery,
    response: campaignJobListSchema,
    detail: {
      summary: "List campaign jobs",
      description:
        "Returns one page of jobs for the owned campaign, ordered by creation. Optional status and title/company search filters apply across the whole campaign.",
    },
  })
  .get("/:id/jobs/reasons", ({ user, params }) => queries.listJobReasons(user.id, params.id), {
    params: idParam,
    response: campaignJobReasonListSchema,
    detail: {
      summary: "List campaign skip/fail reasons",
      description: "Returns every skip and fail reason with its job count, most frequent first.",
    },
  })
  .get("/:id/jobs/:key", ({ user, params }) => queries.getJob(user.id, params.id, params.key), {
    params: campaignJobParams,
    response: campaignJobSchema,
    detail: {
      summary: "Read campaign job",
      description:
        "Returns one job in an owned campaign, independent of list filters and pagination.",
    },
  })
  .post("/:id/jobs", ({ user, params, body }) => svc.addJob(user.id, params.id, body), {
    params: idParam,
    body: addCampaignJobSchema,
    response: campaignJobSchema,
    detail: {
      summary: "Add campaign job",
      description:
        "Adds a discovered job to the campaign, consumes its matching pending queue entry, emits SSE updates, and returns the created job.",
    },
  })
  .patch(
    "/:id/jobs/:key",
    ({ user, params, body }) => svc.patchJob(user.id, params.id, params.key, body),
    {
      params: campaignJobParams,
      body: patchCampaignJobSchema,
      response: campaignJobSchema,
      detail: {
        summary: "Update campaign job",
        description:
          "Applies a validated non-terminal status transition or content update, emits SSE updates, and returns the updated job. Terminal outcomes are accepted only by the result route.",
      },
    },
  )
  .post(
    "/:id/jobs/:key/submission-resume",
    async ({ user, params, request }) => {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw badRequest("file field is required");
      return submissions.uploadResume(user.id, params.id, params.key, file);
    },
    {
      params: campaignJobParams,
      response: submittedResumeSchema,
      // The handler reads FormData; the rate-limit hook otherwise makes Elysia parse it first.
      parse: "none",
      beforeHandle: rateLimit(RATE_LIMITS.submissionUpload),
      detail: {
        summary: "Retain the exact resume PDF submitted for an owned campaign job",
        description:
          "Upload the same PDF bytes staged to the employer. Returns the job, filename and SHA-256 reference required by a new applied result; does not record an application.",
      },
    },
  )
  .post(
    "/:id/jobs/:key/result",
    ({ user, params, body }) => svc.recordJobResult(user.id, params.id, params.key, body),
    {
      params: campaignJobParams,
      body: campaignJobResultSchema,
      response: campaignJobResultResponseSchema,
      detail: {
        summary: "Record campaign job result",
        description:
          "Conditionally records an idempotent terminal outcome, atomically upserts the Application and initial event when applied, marks the queue entry, and returns the current derived summary.",
      },
    },
  )
  .post(
    "/:id/jobs/:key/retry",
    ({ user, params, body }) => svc.retryJob(user.id, params.id, params.key, body),
    {
      params: campaignJobParams,
      body: retryCampaignJobSchema,
      response: campaignJobSchema,
      detail: {
        summary: "Retry a failed campaign job",
        description:
          "Conditionally returns a failed job to the approved queue and clears its terminal failure fields. This is the only failed-to-active transition.",
      },
    },
  )
  .post(
    "/:id/jobs/:key/rescan",
    ({ user, params, body }) => svc.rescanJob(user.id, params.id, params.key, body),
    {
      params: campaignJobParams,
      body: rescanCampaignJobSchema,
      response: campaignJobSchema,
      detail: {
        summary: "Record a skipped-job rescan",
        description:
          "Refresh skipped-job posting fields with action:refresh, obtain a verified score, then send a separate decision to approve or keep it skipped. Scores are written only by score-fit.",
      },
    },
  );
