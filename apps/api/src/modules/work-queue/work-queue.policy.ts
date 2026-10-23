import type { WorkItem, WorkState } from "@openapply/contracts/work-queue";
import { sha256 } from "@/common/crypto/hash";
import { conflict } from "@/common/errors";

export const WORK_LEASE_MS = 90_000;
export const LIVE_WORK_STATES: WorkState[] = ["preparing", "ready", "filling", "stopping"];
export const TERMINAL_WORK_STATES: WorkState[] = [
  "submitted",
  "skipped",
  "failed",
  "cancelled",
  "completed",
];
export const RECOVERY_REASON =
  "Execution stopped before its outcome was verified. Inspect the saved submission attempt and browser state before continuing; never repeat an ambiguous Submit.";

export function workHash(value: unknown): string {
  return sha256(JSON.stringify(value));
}

export function applicationProgressState(state: WorkState, jobStatus: string): WorkState {
  if (state === "preparing" && jobStatus === "approved") return "ready";
  if ((state === "preparing" || state === "ready") && jobStatus === "applying") return "filling";
  return state;
}

export function checkWorkLease(
  item: { state: WorkState; leaseToken: string | null; leaseExpiresAt: Date | null },
  token: string,
  now = new Date(),
) {
  if (
    item.leaseToken !== token ||
    !item.leaseExpiresAt ||
    item.leaseExpiresAt <= now ||
    !LIVE_WORK_STATES.includes(item.state)
  )
    throw conflict("Work lease expired or does not match. Stop execution and inspect the queue.");
}

export function controlState(
  item: Pick<WorkItem, "state" | "kind">,
  action: "pause" | "resume" | "stop",
): WorkState {
  if (action === "resume") {
    if (!["paused", "needs_user", "failed", "cancelled"].includes(item.state))
      throw conflict("Only parked or stopped work can be explicitly resumed.");
    return "queued";
  }
  if (TERMINAL_WORK_STATES.includes(item.state)) return item.state;
  if (LIVE_WORK_STATES.includes(item.state)) return "stopping";
  return action === "pause" ? "paused" : "cancelled";
}

export function settledState(input: {
  kind: WorkItem["kind"];
  recorded: boolean;
  ambiguous: boolean;
  jobStatus?: string;
  pause: boolean;
  stop: boolean;
  outcome: "completed" | "failed" | "cancelled" | "waiting";
}): WorkState {
  if (input.kind === "application") {
    if (input.recorded) return "submitted";
    if (input.ambiguous) return "needs_user";
  }
  if (input.pause) return "paused";
  if (input.stop || input.outcome === "cancelled") return "cancelled";
  if (input.outcome === "waiting" || input.jobStatus === "needs_user") return "needs_user";
  if (input.kind === "application") {
    if (input.jobStatus === "skipped") return "skipped";
    if (input.jobStatus === "failed" || input.outcome === "failed") return "failed";
    return "needs_user";
  }
  return input.outcome === "failed" ? "failed" : "completed";
}
