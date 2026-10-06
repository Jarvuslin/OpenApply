import {
  campaignActorSchema,
  campaignConfigSchema,
  campaignJobStatusSchema,
  campaignSourceSchema,
  campaignStatusSchema,
  campaignSummarySchema,
} from "@openapply/contracts/campaign";
import { csvArray, paginatedSchema, paginationQuerySchema } from "@openapply/contracts/pagination";
import { z } from "zod/v4";

export const campaignsQuery = paginationQuerySchema.extend({
  // The workspace pages Active (in_progress+paused) and Completed as two separate lists.
  status: csvArray(campaignStatusSchema).optional(),
  source: campaignSourceSchema.optional(),
  // "Still has work of this kind", in SQL: a caller filtering its page only sees that page.
  jobStatus: campaignJobStatusSchema.optional(),
});

export const campaignSchema = z.object({
  campaignId: z.uuid(),
  userId: z.uuid(),
  query: z.string(),
  source: campaignSourceSchema,
  status: campaignStatusSchema,
  createdBy: campaignActorSchema,
  statusActor: campaignActorSchema.nullable(),
  statusReason: z.string().nullable(),
  startedAt: z.date(),
  updatedAt: z.date(),
  completedAt: z.date().nullable(),
  config: campaignConfigSchema,
  summary: campaignSummarySchema,
});

export const campaignListSchema = paginatedSchema(campaignSchema);
export const campaignDeletedSchema = z.object({ deleted: z.boolean(), campaignId: z.uuid() });
