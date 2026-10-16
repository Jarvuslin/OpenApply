import type { Prisma } from "@/generated/prisma/client";

// Waiting lets a flaky site or a rate limit clear before the same job is tried again.
const AUTO_RETRY_DELAY_MS = 15 * 60_000;
export const MAX_AUTO_RETRIES = 2;
const MAX_FAILURE_CHARS = 500;

/** Failed application rows whose wait is over and that still have automatic retries left. */
export function autoRetryWhere(userId: string, now: Date): Prisma.WorkItemWhereInput {
  return {
    userId,
    kind: "application",
    state: "failed",
    autoRetries: { lt: MAX_AUTO_RETRIES },
    finishedAt: { lte: new Date(now.getTime() - AUTO_RETRY_DELAY_MS) },
  };
}

/** The work item's payload with the failure the next run must diagnose first. */
export function withPreviousFailure(
  payload: Prisma.JsonValue,
  reason: string | null,
): Prisma.JsonObject {
  const base: Prisma.JsonObject =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Prisma.JsonObject)
      : {};
  const failure = (reason?.trim() || "The run failed without a recorded reason.").slice(
    0,
    MAX_FAILURE_CHARS,
  );
  return { ...base, previousFailure: failure };
}

/** The prompt line that tells a retried run why the last one failed. */
export function previousFailureNote(payload: Prisma.JsonValue): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const failure = (payload as Prisma.JsonObject).previousFailure;
  if (typeof failure !== "string" || !failure) return "";
  return ` This is an automatic retry. The previous run failed with: ${JSON.stringify(failure)}. Diagnose that cause first from the current page and submission state, then take a different approach so the same failure does not repeat. If the cause cannot be fixed by the agent, stop and report it.`;
}
