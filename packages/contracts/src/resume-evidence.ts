import { z } from "zod/v4";
import { paginatedSchema, paginationQuerySchema } from "./pagination";

export const RESUME_EVIDENCE_STATUSES = ["supported", "unverified", "retracted"] as const;
const resumeEvidenceReferenceSchema = z.object({
  evidenceId: z.uuid(),
  revision: z.number().int().positive(),
});
export type ResumeEvidenceReference = z.infer<typeof resumeEvidenceReferenceSchema>;

const quote = z.string().trim().min(1).max(10_000);
const resumeEvidenceSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("resume"),
    version: z.number().int().positive(),
    path: z
      .string()
      .regex(
        /^\/(basics|summary|experience|projects|skills|education|publications|awards|certifications|sections)(\/[^/]+)*$/,
      ),
    quote,
  }),
  z.object({
    kind: z.literal("profile"),
    field: z.enum([
      "firstName",
      "lastName",
      "preferredName",
      "currentCompany",
      "website",
      "linkedin",
      "github",
      "portfolio",
      "city",
      "state",
      "country",
    ]),
    quote,
  }),
  z.object({
    kind: z.literal("github"),
    repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    commitSha: z.string().regex(/^[a-f0-9]{40}$/),
    path: z
      .string()
      .min(1)
      .max(500)
      .refine(
        (value) => !value.startsWith("/") && !value.split("/").includes(".."),
        "Use a repository-relative file path",
      ),
    quote,
    attribution: z.object({ kind: z.literal("profile_github") }),
  }),
  z.object({ kind: z.literal("unverified"), note: z.string().trim().min(1).max(2000) }),
]);

const resumeEvidenceReviewSchema = z.object({
  claimType: z.enum(["explicit", "supported_interpretation", "unverified"]),
  context: z.enum(["personal_assertion", "hypothetical", "suggestion", "uncertain"]),
  rationale: z.string().trim().min(1).max(4000),
});

export const createResumeEvidenceSchema = z.object({
  statement: z.string().trim().min(1).max(4000),
  scope: z.string().regex(/^(general|\/(experience|projects)\/\d+)$/),
  status: z.enum(["supported", "unverified"]),
  source: resumeEvidenceSourceSchema,
  review: resumeEvidenceReviewSchema,
  optionalQuestion: z.string().trim().min(1).max(1000).nullable().optional(),
});
export type CreateResumeEvidence = z.infer<typeof createResumeEvidenceSchema>;
export const correctResumeEvidenceSchema = createResumeEvidenceSchema.extend({
  expectedRevision: z.number().int().positive(),
});
export type CorrectResumeEvidence = z.infer<typeof correctResumeEvidenceSchema>;
export const retractResumeEvidenceQuerySchema = z.object({
  revision: z.coerce.number().int().positive(),
});
export const resumeEvidenceQuerySchema = paginationQuerySchema.extend({
  status: z.enum(RESUME_EVIDENCE_STATUSES).optional(),
});
export type ResumeEvidenceQuery = z.infer<typeof resumeEvidenceQuerySchema>;

export const resumeEvidenceSchema = createResumeEvidenceSchema.extend({
  id: z.uuid(),
  resumeId: z.uuid(),
  revision: z.number().int().positive(),
  status: z.enum(RESUME_EVIDENCE_STATUSES),
  optionalQuestion: z.string().nullable(),
  verification: z.object({
    resumeVersion: z.number().int().positive(),
    scopeSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    sourceSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    sourceRecord: z.string(),
    sourceUrl: z.string().nullable(),
    authorLogin: z.string().nullable(),
    limitation: z.string(),
  }),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type ResumeEvidence = z.infer<typeof resumeEvidenceSchema>;
export const resumeEvidenceListSchema = paginatedSchema(resumeEvidenceSchema);

// Artifact snapshots are JSON records; API records above retain actual Date values.
export const resumeEvidenceSnapshotSchema = resumeEvidenceSchema.extend({
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ResumeEvidenceSnapshot = z.infer<typeof resumeEvidenceSnapshotSchema>;
