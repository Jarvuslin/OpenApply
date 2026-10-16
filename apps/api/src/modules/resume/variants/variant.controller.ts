import {
  PROTECTED_VARIANT_LABELS,
  resumeVariantCreateSchema,
  resumeVariantPatchSchema,
} from "@openapply/contracts/resume";
import { idParam } from "@openapply/contracts/shared";
import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { deletedResponseSchema, idResponseSchema } from "@/types/response";
import { resumeUpdatedSchema } from "../resume.schema";
import {
  artifactParams,
  currentArtifactSchema,
  resumeArtifactSchema,
} from "../resume-artifact.schema";
import { ResumeArtifactService } from "../resume-artifact.service";
import {
  prunedResponseSchema,
  pruneVariantsQuerySchema,
  tailoredVariantSchema,
  tailorResumeSchema,
  variantDetailSchema,
  variantListSchema,
} from "./variant.schema";
import { ResumeVariantService } from "./variant.service";

const svc = container.resolve(ResumeVariantService);
const artifacts = container.resolve(ResumeArtifactService);

export const resumeVariantController = new Elysia({
  name: "resume-variants",
  prefix: "/resumes",
  detail: { tags: ["Resumes"] },
})
  .use(authGuard)
  .get("/variants/:id/pdf", ({ user, params }) => svc.renderVariantPdf(user.id, params.id), {
    params: idParam,
    detail: {
      summary: "Render variant PDF",
      description:
        "Streams the persisted canonical PDF revision matching this variant. It never regenerates submitted or previewed bytes.",
    },
  })
  .get(
    "/variants/:id/artifacts",
    async ({ user, params }) =>
      artifacts.current(user.id, await artifacts.variantResumeId(user.id, params.id), params.id),
    {
      params: idParam,
      response: currentArtifactSchema,
      beforeHandle: rateLimit(RATE_LIMITS.resumeArtifactRead),
      detail: { summary: "Get the current immutable variant revision, if generated" },
    },
  )
  .post(
    "/variants/:id/artifacts",
    async ({ user, params }) =>
      artifacts.create(user.id, await artifacts.variantResumeId(user.id, params.id), params.id),
    {
      params: idParam,
      response: resumeArtifactSchema,
      beforeHandle: rateLimit(RATE_LIMITS.resumeCompile),
      detail: { summary: "Explicitly compile a saved variant into the canonical resume format" },
    },
  )
  .get(
    "/variants/:id/artifacts/:revision",
    async ({ user, params }) =>
      artifacts.get(
        user.id,
        await artifacts.variantResumeId(user.id, params.id),
        params.id,
        params.revision,
      ),
    {
      params: artifactParams,
      response: resumeArtifactSchema,
      beforeHandle: rateLimit(RATE_LIMITS.resumeArtifactRead),
      detail: { summary: "Get a saved variant revision with its exact review evidence" },
    },
  )
  .get(
    "/variants/:id/artifacts/:revision/pdf",
    async ({ user, params }) =>
      artifacts.file(
        user.id,
        await artifacts.variantResumeId(user.id, params.id),
        params.id,
        params.revision,
        "pdf",
      ),
    {
      params: artifactParams,
      beforeHandle: rateLimit(RATE_LIMITS.resumeArtifactRead),
      detail: { summary: "Download the exact PDF for an immutable variant revision" },
    },
  )
  .get(
    "/variants/:id/artifacts/:revision/tex",
    async ({ user, params }) =>
      artifacts.file(
        user.id,
        await artifacts.variantResumeId(user.id, params.id),
        params.id,
        params.revision,
        "tex",
      ),
    {
      params: artifactParams,
      beforeHandle: rateLimit(RATE_LIMITS.resumeArtifactRead),
      detail: { summary: "Download the exact LaTeX source for an immutable variant revision" },
    },
  )
  .get("/:id/variants", ({ user, params }) => svc.listVariants(user.id, params.id), {
    params: idParam,
    response: variantListSchema,
    detail: {
      summary: "List resume variants",
      description:
        "Returns all tailored variants belonging to the given master resume, ordered by most recently updated.",
    },
  })
  .post("/:id/variants", ({ user, params, body }) => svc.createVariant(user.id, params.id, body), {
    beforeHandle: rateLimit(RATE_LIMITS.resumeCompile),
    params: idParam,
    body: resumeVariantCreateSchema,
    response: idResponseSchema,
    detail: {
      summary: "Create resume variant",
      description:
        "Creates a tailored variant under the given master resume from explicit structured content and returns the new variant's id.",
    },
  })
  .post(
    "/:id/tailor",
    ({ user, params, body }) => svc.createTailoredVariant(user.id, params.id, body),
    {
      params: idParam,
      body: tailorResumeSchema,
      beforeHandle: rateLimit(RATE_LIMITS.resumeCompile),
      response: tailoredVariantSchema,
      detail: {
        summary: "Create tailored variant",
        description:
          "Deterministically tailors the master resume from model-authored hints (summary, emphasized tech, validated bullet rewrites) and returns the new variant's id, PDF URL, reworded bullet count, and flags.",
      },
    },
  )
  .get("/variants/:id", ({ user, params }) => svc.getVariant(user.id, params.id), {
    params: idParam,
    response: variantDetailSchema,
    detail: {
      summary: "Get resume variant",
      description:
        "Returns a single tailored variant owned by the active profile, including its parsed content, diff notes, and rewrite audit.",
    },
  })
  .patch("/variants/:id", ({ user, params, body }) => svc.updateVariant(user.id, params.id, body), {
    params: idParam,
    body: resumeVariantPatchSchema,
    response: idResponseSchema,
    detail: {
      summary: "Update resume variant",
      description:
        "Partially updates a tailored variant's label, job URL, application link, content, or diff notes and returns the variant id.",
    },
  })
  .delete("/variants/:id", ({ user, params }) => svc.removeVariant(user.id, params.id), {
    params: idParam,
    response: deletedResponseSchema,
    detail: {
      summary: "Delete resume variant",
      description:
        "Deletes a tailored variant owned by the active profile and returns the deleted variant id.",
    },
  })
  .post("/variants/:id/apply", ({ user, params }) => svc.applyVariant(user.id, params.id), {
    params: idParam,
    response: resumeUpdatedSchema,
    detail: {
      summary: "Apply resume variant",
      description:
        "Writes the variant's content onto its master resume in one transaction, bumping the resume's version and deleting the variant. Returns the resume id and new version.",
    },
  })
  // Registered after /variants/:id so the static segment cannot shadow it.
  .delete(
    "/:id/variants",
    ({ user, params, query }) => svc.pruneVariants(user.id, params.id, query),
    {
      params: idParam,
      query: pruneVariantsQuerySchema,
      response: prunedResponseSchema,
      detail: {
        summary: "Prune resume variants",
        description: `Bulk-deletes accumulated variants under a master resume and returns how many were removed. Filters: \`before\` (created before an instant), \`keep\` (retain the N newest matches), \`unlinkedOnly\` (default true - skip variants linked to an application). Variants labelled ${PROTECTED_VARIANT_LABELS.map((label) => `'${label}'`).join(" or ")} are never pruned.`,
      },
    },
  );
