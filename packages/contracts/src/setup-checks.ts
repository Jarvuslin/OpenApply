import { z } from "zod/v4";

const SETUP_CHECK_STATUSES = ["ok", "fail", "warn", "unknown"] as const;

/** One row of `node scripts/openapply.mjs doctor --json`, served by the terminal at GET /setup/checks. */
const setupCheckSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  status: z.enum(SETUP_CHECK_STATUSES),
  required: z.boolean(),
  detail: z.string(),
  fix: z.string(),
});

export const setupChecksSchema = z.object({ checks: z.array(setupCheckSchema) });

export type SetupCheck = z.infer<typeof setupCheckSchema>;
