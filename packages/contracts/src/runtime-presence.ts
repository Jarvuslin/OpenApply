import { z } from "zod/v4";
export const RUNTIME_STATES = ["ready", "busy", "blocked", "stopped"] as const;
export const RUNTIME_BLOCKING_CODES = [
  "model_approval_required",
  "budget_exhausted",
  "provider_unavailable",
  "browser_unavailable",
  "runtime_error",
] as const;
export const runtimeHeartbeatSchema = z
  .object({
    runtimeId: z.uuid(),
    state: z.enum(RUNTIME_STATES),
    executionAvailable: z.boolean(),
    blockingCode: z.enum(RUNTIME_BLOCKING_CODES).nullable(),
  })
  .strict()
  .refine(
    (value) =>
      !value.executionAvailable ||
      ((value.state === "ready" || value.state === "busy") && value.blockingCode === null),
    { message: "Available execution requires a ready or busy runtime without a blocker." },
  );
export const runtimePresenceSchema = z.object({
  status: z.enum(["online", "offline", "unknown"]),
  lastSeenAt: z.date().nullable(),
  state: z.enum(RUNTIME_STATES).nullable(),
  executionAvailable: z.boolean(),
  blockingCode: z.enum(RUNTIME_BLOCKING_CODES).nullable(),
});
export type RuntimeHeartbeat = z.infer<typeof runtimeHeartbeatSchema>;
