import {
  pilotInputSchema,
  pilotListSchema,
  pilotPreviewResponseSchema,
  pilotPreviewSchema,
  pilotResultActionResponseSchema,
  pilotResultActionSchema,
  pilotResultListSchema,
  pilotResultsQuerySchema,
  pilotRunSchema,
  pilotSchema,
  updatePilotSchema,
} from "@openapply/contracts/pilots";
import { idParam } from "@openapply/contracts/shared";
import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { idResponseSchema } from "@/types/response";
import { PilotsService } from "./pilots.service";

const pilots = container.resolve(PilotsService);
const limitRead = rateLimit(RATE_LIMITS.pilotsRead);
const limitPreview = rateLimit(RATE_LIMITS.pilotsPreview);
const limitMutation = rateLimit(RATE_LIMITS.pilotsMutation);

export const pilotsController = new Elysia({ prefix: "/pilots", detail: { tags: ["Pilots"] } })
  .use(authGuard)
  .get("/", ({ user }) => pilots.list(user.id), {
    beforeHandle: limitRead,
    response: pilotListSchema,
    detail: { summary: "List pilots", description: "Every pilot with its counts and last run." },
  })
  .post("/", ({ user, body }) => pilots.create(user.id, body), {
    body: pilotInputSchema,
    beforeHandle: limitMutation,
    response: pilotSchema,
    detail: {
      summary: "Create a pilot",
      description: "Saves the rules and schedule and opens the pilot's own campaign for results.",
    },
  })
  .post("/preview", ({ user, body }) => pilots.preview(user.id, body.rules), {
    body: pilotPreviewSchema,
    beforeHandle: limitPreview,
    response: pilotPreviewResponseSchema,
    detail: {
      summary: "Count matching listings",
      description:
        "Listings that pass the rules right now, per posted-within window, before scoring.",
    },
  })
  .get("/:id", ({ user, params }) => pilots.detail(user.id, params.id), {
    params: idParam,
    beforeHandle: limitRead,
    response: pilotSchema,
    detail: { summary: "Get a pilot" },
  })
  .patch("/:id", ({ user, params, body }) => pilots.update(user.id, params.id, body), {
    params: idParam,
    body: updatePilotSchema,
    beforeHandle: limitMutation,
    response: pilotSchema,
    detail: { summary: "Update a pilot", description: "Changing the schedule restarts its timer." },
  })
  .delete("/:id", ({ user, params }) => pilots.remove(user.id, params.id), {
    params: idParam,
    beforeHandle: limitMutation,
    response: idResponseSchema,
    detail: {
      summary: "Delete a pilot",
      description: "Stops any run. Jobs already added to the queue stay there.",
    },
  })
  .post("/:id/run", ({ user, params }) => pilots.run(user.id, params.id, "manual"), {
    params: idParam,
    beforeHandle: limitMutation,
    response: pilotRunSchema,
    detail: {
      summary: "Run a pilot now",
      description: "Starts one run whose results wait for review. 409 while a run is in progress.",
    },
  })
  .post("/:id/stop", ({ user, params }) => pilots.stop(user.id, params.id), {
    params: idParam,
    beforeHandle: limitMutation,
    response: pilotRunSchema,
    detail: {
      summary: "Stop a pilot run",
      description: "Stops scoring and keeps the jobs scored so far.",
    },
  })
  .get("/:id/results", ({ user, params, query }) => pilots.results(user.id, params.id, query), {
    params: idParam,
    query: pilotResultsQuerySchema,
    beforeHandle: limitRead,
    response: pilotResultListSchema,
    detail: { summary: "List pilot results", description: "Results with one status, paginated." },
  })
  .post(
    "/:id/results/queue",
    ({ user, params, body }) => pilots.queueResults(user.id, params.id, body),
    {
      params: idParam,
      body: pilotResultActionSchema,
      beforeHandle: limitMutation,
      response: pilotResultActionResponseSchema,
      detail: {
        summary: "Add pilot results to the queue",
        description:
          "Each job goes through normal queue admission; refused ones come back skipped.",
      },
    },
  )
  .post(
    "/:id/results/remove",
    ({ user, params, body }) => pilots.removeResults(user.id, params.id, body),
    {
      params: idParam,
      body: pilotResultActionSchema,
      beforeHandle: limitMutation,
      response: pilotResultActionResponseSchema,
      detail: {
        summary: "Remove pilot results",
        description: "Removed jobs never come back for this pilot.",
      },
    },
  );
