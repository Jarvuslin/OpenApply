import {
  autoApplySettingsSchema,
  setPrimaryResumeSchema,
  userWithAutoApplySchema,
} from "@openapply/contracts/user";
import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { badRequest } from "@/common/errors";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { idResponseSchema, okResponseSchema } from "@/types/response";
import { TranscriptService } from "./transcript.service";
import { primaryResumeSetSchema, transcriptSavedSchema, userAggregateSchema } from "./user.schema";
import { UserService } from "./user.service";

const svc = container.resolve(UserService);
const transcripts = container.resolve(TranscriptService);

export const userController = new Elysia({
  prefix: "/user",
  detail: { tags: ["User"] },
})
  .use(authGuard)
  .get("/", ({ user }) => svc.get(user.id), {
    response: userAggregateSchema,
    detail: {
      summary: "Get current user",
      description:
        "Returns the current user aggregate, including its auto-apply settings, references, and resumes.",
    },
  })
  .put("/", ({ user, body }) => svc.update(user.id, body), {
    body: userWithAutoApplySchema,
    response: idResponseSchema,
    detail: {
      summary: "Replace current user",
      description:
        "Performs a full replace of the current user's applicant data and auto-apply settings, returning the updated user id.",
    },
  })
  .put("/auto-apply", ({ user, body }) => svc.setAutoApply(user.id, body), {
    body: autoApplySettingsSchema,
    response: okResponseSchema,
    detail: {
      summary: "Save the queue's apply defaults: minimum score, per-search cap, availability",
    },
  })
  .post(
    "/transcript",
    async ({ user, request }) => {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw badRequest("file field is required");
      return transcripts.upload(user.id, file);
    },
    {
      response: transcriptSavedSchema,
      // The handler reads FormData; the rate-limit hook otherwise makes Elysia parse it first.
      parse: "none",
      beforeHandle: rateLimit(RATE_LIMITS.submissionUpload),
      detail: { summary: "Save the profile's unofficial transcript PDF" },
    },
  )
  .get("/transcript", ({ user }) => transcripts.download(user.id), {
    detail: { summary: "Download the profile's transcript PDF" },
  })
  .delete("/transcript", ({ user }) => transcripts.remove(user.id), {
    response: okResponseSchema,
    detail: { summary: "Remove the profile's transcript" },
  })
  .put("/primary-resume", ({ user, body }) => svc.setPrimaryResume(user.id, body.resumeId), {
    body: setPrimaryResumeSchema,
    response: primaryResumeSetSchema,
    detail: {
      summary: "Set primary resume",
      description:
        "Marks one of the user's resumes as primary (or clears it with `null`), returning the new primary resume id.",
    },
  });
