import {
  requestAccountSetupResultSchema,
  requestAccountSetupSchema,
} from "@openapply/contracts/account-setup";
import { idParam } from "@openapply/contracts/shared";
import { workQueueChannel } from "@openapply/contracts/sse";
import {
  controlWorkSchema,
  enqueueCampaignWorkSchema,
  enqueueWorkResultSchema,
  enqueueWorkSchema,
  finishWorkSchema,
  removeWorkResultSchema,
  workClaimInputSchema,
  workClaimSchema,
  workDetailSchema,
  workEventInputSchema,
  workEventSchema,
  workItemSchema,
  workLeaseSchema,
  workListQuerySchema,
  workListSchema,
  workObserverQuerySchema,
  workObserverSchema,
  workOrderedInputSchema,
  workOrderedSchema,
  workScheduleInputSchema,
  workScheduleSchema,
  workSummarySchema,
  workTimelineSchema,
} from "@openapply/contracts/work-queue";
import {
  queueEstimateQuerySchema,
  queueEstimateSchema,
  queueLimitsSchema,
  queueRunnableSchema,
  updateQueueLimitsSchema,
} from "@openapply/contracts/work-queue-limits";
import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { badRequest } from "@/common/errors";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { sseStream } from "@/common/sse";
import { AccountSetupService } from "@/modules/account-setup/account-setup.service";
import { okResponseSchema } from "@/types/response";
import { WorkQueueClaimService } from "./work-queue.claim";
import { WorkQueueLimitsService } from "./work-queue.limits";
import { WorkQueueReadService } from "./work-queue.read";
import { createQueueReadLimits } from "./work-queue.read-limits";
import { WorkQueueSchedulerService } from "./work-queue.scheduler";
import { WorkQueueScreenshotService } from "./work-queue.screenshot";
import { WorkQueueService } from "./work-queue.service";
import { WorkQueueTimelineService } from "./work-queue.timeline";

const queue = container.resolve(WorkQueueService);
const accounts = container.resolve(AccountSetupService);
const scheduler = container.resolve(WorkQueueSchedulerService);
const claims = container.resolve(WorkQueueClaimService);
const limits = container.resolve(WorkQueueLimitsService);
const reads = container.resolve(WorkQueueReadService);
const screenshots = container.resolve(WorkQueueScreenshotService);
const timelines = container.resolve(WorkQueueTimelineService);
const read = createQueueReadLimits();
const mutate = rateLimit(RATE_LIMITS.workQueueMutation);
const runtime = rateLimit(RATE_LIMITS.workQueueRuntime);

export const workQueueController = new Elysia({
  prefix: "/work-queue",
  detail: { tags: ["Work queue"] },
})
  .use(authGuard)
  .post("/ordered", ({ user, body }) => reads.ordered(user.id, body), {
    body: workOrderedInputSchema,
    response: workOrderedSchema,
    beforeHandle: read.ordered,
    detail: { summary: "Order only the exact supplied owned work IDs without claims or recovery" },
  })
  .get("/:id/observer", ({ user, params, query }) => reads.observer(user.id, params.id, query), {
    params: idParam,
    query: workObserverQuerySchema,
    response: workObserverSchema,
    beforeHandle: read.observer,
    detail: { summary: "Read exact owned browser execution liveness without renewing its lease" },
  })
  .get("/limits", ({ user }) => limits.read(user.id), {
    response: queueLimitsSchema,
    beforeHandle: read.limits,
    detail: { summary: "Read persisted account queue limits" },
  })
  .put("/limits", ({ user, body, authKind }) => limits.update(user.id, body, authKind), {
    body: updateQueueLimitsSchema,
    response: queueLimitsSchema,
    beforeHandle: mutate,
    detail: { summary: "Save confirmed queue limits without starting work" },
  })
  .get("/estimate", ({ user, query }) => limits.estimate(user.id, query.campaignId), {
    query: queueEstimateQuerySchema,
    response: queueEstimateSchema,
    beforeHandle: read.estimate,
    detail: { summary: "Read whole-queue preflight without model execution" },
  })
  .get("/", ({ user, query }) => queue.list(user.id, query), {
    query: workListQuerySchema,
    response: workListSchema,
    beforeHandle: read.list,
    detail: { summary: "List owned durable work" },
  })
  .get(
    "/runnable",
    async ({ user }) => {
      await accounts.autoContinue(user.id);
      return queue.runnable(user.id);
    },
    {
      response: queueRunnableSchema,
      beforeHandle: runtime,
      detail: { summary: "List queued work a connected computer may start now" },
    },
  )
  .get("/summary", ({ user }) => queue.summary(user.id), {
    response: workSummarySchema,
    beforeHandle: read.summary,
    detail: { summary: "Count work by current state" },
  })
  .post("/enqueue", ({ user, body }) => queue.enqueue(user.id, body), {
    body: enqueueWorkSchema,
    response: enqueueWorkResultSchema,
    beforeHandle: mutate,
    detail: { summary: "Queue exact owned jobs without creating conversations" },
  })
  .post("/campaign/:id", ({ user, params, body }) => queue.campaign(user.id, params.id, body), {
    params: idParam,
    body: enqueueCampaignWorkSchema,
    response: enqueueWorkResultSchema,
    beforeHandle: mutate,
    detail: { summary: "Queue scoped campaign preparation" },
  })
  .post("/claim", ({ user, body }) => claims.claim(user.id, body), {
    body: workClaimInputSchema,
    response: workClaimSchema,
    beforeHandle: runtime,
    detail: {
      summary: "Lease one explicitly approved owned work item with an isolated browser identity",
    },
  })
  .post("/schedule", ({ user, body }) => scheduler.schedule(user.id, body.provider), {
    body: workScheduleInputSchema,
    response: workScheduleSchema,
    beforeHandle: mutate,
    detail: { summary: "Admit due Pilot work without model execution" },
  })
  .get(
    "/events",
    ({ user, headers }) => sseStream(workQueueChannel, { userId: user.id }, headers),
    { detail: { summary: "Stream owned queue changes" } },
  )
  .get("/:id", ({ user, params }) => queue.detail(user.id, params.id), {
    params: idParam,
    response: workDetailSchema,
    beforeHandle: read.detail,
    detail: { summary: "Read owned work and recent progress" },
  })
  .post(
    "/:id/control",
    ({ user, params, body }) => queue.control(user.id, params.id, body.action),
    {
      params: idParam,
      body: controlWorkSchema,
      response: workItemSchema,
      beforeHandle: mutate,
      detail: { summary: "Pause, stop or explicitly resume work" },
    },
  )
  .delete("/:id", ({ user, params }) => queue.remove(user.id, params.id), {
    params: idParam,
    response: removeWorkResultSchema,
    beforeHandle: mutate,
    detail: { summary: "Remove work from the queue, stopping it first if it is running" },
  })
  .post(
    "/:id/account-setup",
    ({ user, params, body, headers }) =>
      accounts.requestForApplication(user.id, params.id, headers["x-openapply-work-lease"], body),
    {
      params: idParam,
      body: requestAccountSetupSchema,
      response: requestAccountSetupResultSchema,
      beforeHandle: runtime,
      detail: {
        summary: "Create the employer account for a leased application with the job login",
      },
    },
  )
  .post(
    "/:id/screenshot",
    async ({ user, params, request, headers }) => {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw badRequest("file field is required");
      return screenshots.save(user.id, params.id, headers["x-openapply-work-lease"], file);
    },
    {
      params: idParam,
      response: okResponseSchema,
      // The handler reads FormData; the rate-limit hook otherwise makes Elysia parse it first.
      parse: "none",
      beforeHandle: runtime,
      detail: { summary: "Save the employer confirmation screenshot for leased application work" },
    },
  )
  .get("/:id/timeline", ({ user, params }) => timelines.timeline(user.id, params.id), {
    params: idParam,
    response: workTimelineSchema,
    beforeHandle: read.detail,
    detail: { summary: "List the milestones of owned work for its activity view" },
  })
  .get("/:id/screenshot", ({ user, params }) => screenshots.read(user.id, params.id), {
    params: idParam,
    beforeHandle: read.detail,
    detail: { summary: "Show the confirmation screenshot of owned application work" },
  })
  .post(
    "/:id/heartbeat",
    ({ user, params, body }) => queue.heartbeat(user.id, params.id, body.leaseToken),
    {
      params: idParam,
      body: workLeaseSchema,
      response: workItemSchema,
      beforeHandle: runtime,
      detail: { summary: "Renew a work lease and read stop requests" },
    },
  )
  .post("/:id/events", ({ user, params, body }) => queue.event(user.id, params.id, body), {
    params: idParam,
    body: workEventInputSchema,
    response: workEventSchema,
    beforeHandle: runtime,
    detail: { summary: "Record an idempotent work event" },
  })
  .post("/:id/finish", ({ user, params, body }) => queue.finish(user.id, params.id, body), {
    params: idParam,
    body: finishWorkSchema,
    response: workItemSchema,
    beforeHandle: runtime,
    detail: { summary: "Settle work from durable application evidence" },
  });
