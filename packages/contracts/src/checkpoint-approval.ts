import { z } from "zod/v4";
export const CHECKPOINT_DECISIONS = ["approve", "skip"] as const;
export const checkpointDecisionSchema = z
  .object({
    requestId: z.uuid(),
    checkpointId: z.uuid(),
    checkpointHash: z.string().regex(/^[a-f0-9]{64}$/),
    decision: z.enum(CHECKPOINT_DECISIONS),
  })
  .strict();
const checkpointApprovalSchema = z.object({
  questionId: z.uuid(),
  checkpointId: z.uuid(),
  checkpointHash: z.string(),
  expiresAt: z.date(),
  decision: z.enum(["approve", "skip"]).nullable(),
  consumedAt: z.date().nullable(),
});
export type CheckpointDecision = z.infer<typeof checkpointDecisionSchema>;
export const checkpointApprovalDetailSchema = checkpointApprovalSchema.extend({
  job: z.object({
    id: z.uuid(),
    campaignId: z.uuid(),
    key: z.string(),
    title: z.string(),
    company: z.string(),
  }),
  reviewPath: z.string(),
});
