import { z } from "zod/v4";

export const AGENT_PROVIDERS = ["claude", "codex"] as const;
export const AGENT_NAMES = ["assistant", "search", "resume", "application", "tracker"] as const;
export const AGENT_EVENT_KINDS = ["text", "activity", "question", "error"] as const;

export const agentEventMetadataSchema = z.object({
  authorship: z.enum(["session_user", "telegram_user", "agent"]).optional(),
  toolName: z.string().max(120).optional(),
  questionId: z.uuid().optional(),
  jobId: z.uuid().optional(),
  toolInvocationId: z
    .string()
    .max(160)
    .regex(/^[a-zA-Z0-9_.:-]+$/)
    .optional(),
  skillName: z
    .string()
    .max(120)
    .regex(/^[a-zA-Z0-9_.:-]+$/)
    .optional(),
  subagentType: z
    .string()
    .max(120)
    .regex(/^[a-zA-Z0-9_.:-]+$/)
    .optional(),
  toolStatus: z.enum(["started", "completed", "failed"]).optional(),
});
