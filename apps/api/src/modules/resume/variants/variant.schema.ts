import { PROTECTED_VARIANT_LABELS, resumeDataSchema } from "@openapply/contracts/resume";
import { resumeEvidenceSnapshotSchema } from "@openapply/contracts/resume-evidence";
import { z } from "zod/v4";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Excludes reserved labels from a sweep. Shared with the retention cron: a sweep that spelled the
 * rule out itself would drift from `isProtectedVariantLabel` and delete a pending suggestion.
 */
export const notProtectedVariant: Prisma.ResumeVariantWhereInput = {
  NOT: PROTECTED_VARIANT_LABELS.map((label) => ({ label: { startsWith: label } })),
};

/** `unlinkedOnly` defaults on, so a bare call sweeps only variants nothing points at. */
export const pruneVariantsQuerySchema = z.object({
  before: z.coerce.date().optional(),
  keep: z.coerce.number().int().min(0).max(100).optional(),
  unlinkedOnly: z.stringbool().optional(),
});

export const prunedResponseSchema = z.object({ deleted: z.number().int() });

const rewriteGroundingSchema = z.object({
  evidence: z
    .array(
      z.object({
        path: z.string().min(1),
        quote: z.string().trim().min(1),
      }),
    )
    .min(1)
    .max(20),
  externalEvidence: z
    .array(
      z.object({
        evidenceId: z.uuid(),
        revision: z.number().int().positive(),
        quote: z.string().trim().min(1),
      }),
    )
    .max(20)
    .optional(),
  target: z.object({
    kind: z.enum(["job_description", "general_review"]),
    quote: z.string().trim().min(1),
    reason: z.string().trim().min(1),
  }),
  review: z.object({
    verdict: z.literal("supported"),
    claimType: z.enum(["explicit", "supported_interpretation"]),
    rationale: z.string().trim().min(1),
  }),
});

export type RewriteGrounding = z.infer<typeof rewriteGroundingSchema>;

const executionReferenceSchema = z.object({
  runId: z.uuid().optional(),
  toolInvocationId: z.string().trim().min(1).max(200).optional(),
});
const unavailableReviewSchema = z.object({
  status: z.literal("unavailable"),
  reason: z.string().trim().min(1),
});
const workflowReviewSchema = z.object({
  evidencePlan: z
    .array(
      z.object({
        target: z.string().trim().min(1),
        sources: z.array(z.string().trim().min(1)).min(1),
        change: z.string().trim().min(1),
      }),
    )
    .min(1)
    .max(100),
  reviewer: z.discriminatedUnion("status", [
    executionReferenceSchema.extend({
      status: z.literal("completed"),
      agentId: z.string().trim().min(1),
      findings: z.array(z.string().trim().min(1)).max(100),
      resolutions: z.array(z.string().trim().min(1)).max(100),
    }),
    unavailableReviewSchema,
  ]),
  humanizer: z.discriminatedUnion("status", [
    executionReferenceSchema.extend({
      status: z.literal("completed"),
      skill: z.literal("humanizer"),
      factualDriftChecked: z.literal(true),
    }),
    unavailableReviewSchema,
  ]),
  optionalQuestions: z.array(z.string().trim().min(1)).max(30),
});
export type WorkflowReview = z.infer<typeof workflowReviewSchema>;

const bulletRewriteSchema = z.object({
  original: z.string(),
  tailored: z.string(),
  // Older saved audits predate evidence review; missing data must not become a fabricated review.
  grounding: rewriteGroundingSchema.optional(),
});
const reviewedRewriteSchema = bulletRewriteSchema.extend({
  original: z.string().min(1),
  tailored: z.string().trim().min(1),
  grounding: rewriteGroundingSchema,
});
const reviewedTextAuditSchema = reviewedRewriteSchema.extend({ original: z.string() });

const entryRewriteAuditSchema = z.object({
  entryIndex: z.number().int(),
  company: z.string(),
  bullets: z.array(bulletRewriteSchema),
});

export type EntryRewriteAudit = z.infer<typeof entryRewriteAuditSchema>;
const projectRewriteAuditSchema = z.object({
  entryIndex: z.number().int(),
  name: z.string(),
  bullets: z.array(bulletRewriteSchema),
});

const structureAuditSchema = z.object({
  merged: z.array(
    z.object({
      company: z.string(),
      absorbed: z.array(z.string()),
      start: z.string(),
      end: z.string(),
    }),
  ),
  dropped: z.array(z.string()),
  promoted: z.array(
    z.object({
      company: z.string(),
      projects: z.array(z.string()),
      start: z.string(),
      end: z.string(),
    }),
  ),
  reordered: z.boolean(),
  retitled: z.array(z.object({ company: z.string(), from: z.string(), to: z.string() })),
  /** Soft, non-blocking review notes. */
  flags: z.array(z.string()),
});

export type StructureAudit = z.infer<typeof structureAuditSchema>;

/** Persisted `ResumeVariant.rewrites` shape. `structure` only on variants that restructured. */
const variantRewriteAuditSchema = z.object({
  experience: z.array(entryRewriteAuditSchema),
  projects: z.array(projectRewriteAuditSchema).optional(),
  summary: reviewedTextAuditSchema.optional(),
  headline: reviewedTextAuditSchema.optional(),
  omissions: z
    .array(
      z.object({
        section: z.enum(["experience", "projects"]),
        entryIndex: z.number().int(),
        original: z.string(),
        reason: z.string(),
      }),
    )
    .optional(),
  reviewMeaning: z
    .literal(
      "Source references and factual invariants are checked; semantic support is an agent review judgment, not proof.",
    )
    .optional(),
  structure: structureAuditSchema.optional(),
  additionalEvidence: z.array(resumeEvidenceSnapshotSchema).optional(),
  workflowReview: workflowReviewSchema.optional(),
  reviewEvidenceMeaning: z
    .literal(
      "Agent-reported workflow; tool execution and semantic correctness are not established by these fields.",
    )
    .optional(),
});

export type VariantRewriteAudit = z.infer<typeof variantRewriteAuditSchema>;

export const variantSummarySchema = z.object({
  id: z.uuid(),
  resumeId: z.uuid(),
  label: z.string(),
  jobUrl: z.string().nullable(),
  applicationId: z.uuid().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const variantListSchema = z.array(variantSummarySchema);

export const variantDetailSchema = z.object({
  id: z.uuid(),
  resumeId: z.uuid(),
  resumeLabel: z.string(),
  label: z.string(),
  jobUrl: z.string().nullable(),
  applicationId: z.uuid().nullable(),
  content: resumeDataSchema,
  diffNotes: z.string().nullable(),
  rewrites: variantRewriteAuditSchema.nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

/** Every index refers to the base resume, so a plan never simulates intermediate states. */
const resumeStructureSchema = z.object({
  entryOrder: z.array(z.number().int().min(0)).optional(),
  dropEntries: z.array(z.number().int().min(0)).optional(),
  mergeEntries: z
    .array(
      z.object({
        /** The entry that absorbs the others and keeps its position. */
        into: z.number().int().min(0),
        /** Merged into `into`, then removed. */
        from: z.array(z.number().int().min(0)).min(1),
        /** One of the merged employers or an umbrella name. */
        company: z.string().min(1).optional(),
        title: z.string().min(1).optional(),
      }),
    )
    .optional(),
  projectOrder: z.array(z.number().int().min(0)).optional(),
  promoteProjects: z
    .object({
      /** Lifted into one synthesized experience entry, dated from the projects themselves. */
      projects: z.array(z.number().int().min(0)).min(1),
      /** Umbrella names only - a promoted project has no employer by definition. */
      company: z.string().min(1).optional(),
      title: z.string().min(1).optional(),
    })
    .optional(),
});

export type StructurePlan = z.infer<typeof resumeStructureSchema>;

export const tailorResumeSchema = z.object({
  label: z.string().min(1),
  jobUrl: z.url().optional().nullable(),
  applicationId: z.uuid().optional().nullable(),
  summary: z.string().optional(),
  headline: z.string().optional(),
  summaryGrounding: rewriteGroundingSchema.optional(),
  headlineGrounding: rewriteGroundingSchema.optional(),
  jobDescription: z.string().optional(),
  emphasizedTech: z.array(z.string()).optional(),
  jobKeywords: z.array(z.string()).optional(),
  diffNotes: z.string().optional().nullable(),
  workflowReview: workflowReviewSchema.optional(),
  maxBulletsPerEntry: z.number().int().min(1).max(20).optional(),
  structure: resumeStructureSchema.optional(),
  bulletRewrites: z
    .array(
      z.object({
        entryIndex: z.number().int().min(0),
        bullets: z.array(reviewedRewriteSchema).min(1),
      }),
    )
    .optional(),
  projectBulletRewrites: z
    .array(
      z.object({
        entryIndex: z.number().int().min(0),
        bullets: z.array(reviewedRewriteSchema).min(1),
      }),
    )
    .optional(),
});

export type TailorVariantBody = z.infer<typeof tailorResumeSchema>;

export const tailoredVariantSchema = z.object({
  id: z.uuid(),
  pdfUrl: z.string(),
  rewordedBullets: z.number().int(),
  flags: z.array(z.string()),
});
