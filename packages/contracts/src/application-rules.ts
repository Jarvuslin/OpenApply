import { z } from "zod/v4";

const applicationRuleSchema = z.object({
  id: z.uuid(),
  company: z.string(),
  companyKey: z.string(),
  active: z.boolean(),
  revision: z.number().int(),
  updatedAt: z.date(),
});
export const applicationRulesSchema = z.object({
  revision: z.number().int(),
  rules: z.array(applicationRuleSchema),
});
export const excludeCompanySchema = z
  .object({
    requestId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    company: z.string().min(1).max(200),
  })
  .strict();
export const undoApplicationRuleSchema = z
  .object({ requestId: z.uuid(), expectedRevision: z.number().int().positive() })
  .strict();
export const applicationRuleChangeSchema = z.object({
  id: z.uuid(),
  revision: z.number().int(),
  rule: applicationRuleSchema,
  undoAvailable: z.boolean(),
});
export type ExcludeCompany = z.infer<typeof excludeCompanySchema>;
export type UndoApplicationRule = z.infer<typeof undoApplicationRuleSchema>;
