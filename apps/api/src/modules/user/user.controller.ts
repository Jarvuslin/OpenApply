import { setPrimaryResumeSchema, userWithAutoApplySchema } from "@openapply/contracts/user";
import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { authGuard } from "@/common/middleware";
import { idResponseSchema } from "@/types/response";
import { primaryResumeSetSchema, userAggregateSchema } from "./user.schema";
import { UserService } from "./user.service";

const svc = container.resolve(UserService);

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
  .put("/primary-resume", ({ user, body }) => svc.setPrimaryResume(user.id, body.resumeId), {
    body: setPrimaryResumeSchema,
    response: primaryResumeSetSchema,
    detail: {
      summary: "Set primary resume",
      description:
        "Marks one of the user's resumes as primary (or clears it with `null`), returning the new primary resume id.",
    },
  });
