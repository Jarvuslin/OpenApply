import { resumeDataSchema } from "@openapply/contracts/resume";
import { idParam } from "@openapply/contracts/shared";
import { z } from "zod/v4";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const artifactParams = idParam.extend({ revision: sha256 });

export const resumeArtifactSchema = z.object({
  revision: sha256,
  resumeId: z.uuid(),
  variantId: z.uuid().nullable(),
  createdAt: z.date(),
  contentSha256: sha256,
  pdfSha256: sha256,
  texSha256: sha256,
  sizeBytes: z.number().int().positive(),
  content: resumeDataSchema,
  template: z.object({ id: z.string(), version: z.string(), sha256 }),
  compiler: z.object({ name: z.string(), version: z.string() }),
  validation: z.object({
    valid: z.literal(true),
    pageCount: z.literal(1),
    pageSize: z.object({ width: z.literal(612), height: z.literal(792) }),
    fontFamilies: z.array(z.string()),
    textVerified: z.literal(true),
    boundsVerified: z.literal(true),
    warnings: z.array(z.string()),
  }),
  source: z.object({
    version: z.number().int(),
    filename: z.string().nullable(),
    sha256: sha256.nullable(),
    content: resumeDataSchema.nullable(),
    contentSha256: sha256.nullable(),
  }),
  job: z.object({
    url: z.string().nullable(),
    description: z.string().nullable(),
    sha256: sha256.nullable(),
  }),
  // Retain the actual review evidence; an arbitrary structured draft is never labeled reviewed.
  audit: z.json().nullable(),
  diffNotes: z.string().nullable(),
  pdfUrl: z.string(),
  texUrl: z.string(),
  metadataUrl: z.string(),
});

export type ResumeArtifact = z.infer<typeof resumeArtifactSchema>;
export const currentArtifactSchema = z.object({ artifact: resumeArtifactSchema.nullable() });
