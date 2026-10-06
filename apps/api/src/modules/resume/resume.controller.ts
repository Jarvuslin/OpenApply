import { resumeDataSchema } from "@jobpilot/contracts/resume";
import { idParam } from "@jobpilot/contracts/shared";
import { resumeChannel } from "@jobpilot/contracts/sse";
import { Elysia } from "elysia";
import { z } from "zod/v4";
import { container } from "@/common/di/container";
import { badRequest } from "@/common/errors";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { sseStream } from "@/common/sse";
import { deletedResponseSchema, idResponseSchema } from "@/types/response";
import {
  createResumeSchema,
  resumeDetailSchema,
  resumeListSchema,
  resumeUpdatedSchema,
  sourceUploadedSchema,
  updateResumeSchema,
} from "./resume.schema";
import { ResumeService } from "./resume.service";

const svc = container.resolve(ResumeService);

interface Upload {
  file: File;
  label?: string;
}

async function readUpload(request: Request): Promise<Upload> {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    throw badRequest("file field is required");
  }
  const label = form.get("label");
  return { file, label: typeof label === "string" ? label : undefined };
}

export const resumeController = new Elysia({
  prefix: "/resumes",
  detail: { tags: ["Resumes"] },
})
  .use(authGuard)
  .post("/:id/extract", ({ user, params }) => svc.extract(user.id, params.id), {
    beforeHandle: rateLimit(RATE_LIMITS.localExtraction),
    params: idParam,
    response: z.object({ content: resumeDataSchema }),
    detail: { summary: "Read a resume locally using PDF.js/Mammoth and the Claude subscription" },
  })
  .get("/", ({ user }) => svc.list(user.id), {
    response: resumeListSchema,
    detail: {
      summary: "List master resumes",
      description:
        "Returns all of the active profile's master resumes ordered by most recently updated, with variant counts and the primary resume listed first.",
    },
  })
  .post("/", ({ user, body }) => svc.createJson(user.id, body), {
    body: createResumeSchema,
    response: idResponseSchema,
    detail: {
      summary: "Create resume from JSON",
      description:
        "Creates a new master resume from a structured JSON body and optional content, returning the new resume's id.",
    },
  })
  .post(
    "/upload",
    async ({ user, request }) => {
      const { file, label } = await readUpload(request);
      return svc.createFromUpload(user.id, file, label);
    },
    {
      response: idResponseSchema,
      detail: {
        summary: "Create resume from upload",
        description:
          "Creates a master resume from a multipart-uploaded source file (and optional label), storing the file on disk and returning the new resume's id.",
      },
    },
  )
  .get("/:id", ({ user, params }) => svc.get(user.id, params.id), {
    params: idParam,
    response: resumeDetailSchema,
    detail: {
      summary: "Get resume",
      description:
        "Returns a single master resume owned by the active profile, including its structured content, version, source-file metadata, and primary flag.",
    },
  })
  .put("/:id", ({ user, params, body }) => svc.update(user.id, params.id, body), {
    params: idParam,
    body: updateResumeSchema,
    response: resumeUpdatedSchema,
    detail: {
      summary: "Update resume",
      description:
        "Updates a master resume's label and/or structured content, bumping the version when content changes, and returns the id and new version.",
    },
  })
  .delete("/:id", ({ user, params }) => svc.remove(user.id, params.id), {
    params: idParam,
    response: deletedResponseSchema,
    detail: {
      summary: "Delete resume",
      description:
        "Deletes a master resume along with its variants and all on-disk artifacts, clears the primary pointer if set, and returns the deleted id.",
    },
  })
  .get(
    "/:id/events",
    async ({ user, params, headers }) => {
      await svc.findOwned(user.id, params.id);
      return sseStream(resumeChannel, { resumeId: params.id }, headers);
    },
    {
      params: idParam,
      detail: {
        summary: "Stream resume change events",
        description:
          "Opens a Server-Sent Events stream that emits content-change events for the resume after verifying the active profile owns it.",
      },
    },
  )
  .get("/:id/pdf", ({ user, params }) => svc.renderPdf(user.id, params.id), {
    params: idParam,
    detail: {
      summary: "Render resume PDF",
      description:
        "Streams the master resume as a cached PDF, rendered from structured content when present, else the uploaded source file.",
    },
  })
  .get("/:id/source", ({ user, params }) => svc.getSource(user.id, params.id), {
    params: idParam,
    detail: {
      summary: "Stream resume source file",
      description: "Streams the resume's uploaded source file, or 404 when there is none.",
    },
  })
  .post(
    "/:id/source",
    async ({ user, params, request }) => {
      const { file } = await readUpload(request);
      return svc.uploadSource(user.id, params.id, file);
    },
    {
      params: idParam,
      response: sourceUploadedSchema,
      detail: {
        summary: "Replace resume source file",
        description:
          "Replaces the resume's source file with a multipart upload and returns the new stored filename.",
      },
    },
  )
  .delete("/:id/source", ({ user, params }) => svc.deleteSource(user.id, params.id), {
    params: idParam,
    response: idResponseSchema,
    detail: {
      summary: "Delete resume source file",
      description: "Removes the resume's uploaded source file and clears its source metadata.",
    },
  });
