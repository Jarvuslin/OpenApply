import type { WorkItem, WorkState } from "@openapply/contracts/work-queue";
import type { QUEUE_BLOCK_REASONS } from "@openapply/contracts/work-queue-limits";
import { formatRelativeTime } from "@/utils/format";

export const QUEUE_STATE_LABELS: Record<WorkState, string> = {
  queued: "Queued",
  preparing: "Preparing",
  ready: "Starting",
  filling: "Applying now",
  needs_user: "Needs you",
  submitted: "Submitted",
  skipped: "Skipped",
  failed: "Couldn't apply",
  paused: "Paused",
  stopping: "Stopping",
  cancelled: "Stopped",
  completed: "Done",
};

export type QueueTone = "active" | "done" | "waiting" | "failed" | "neutral";

export const QUEUE_STATE_TONES: Record<WorkState, QueueTone> = {
  queued: "neutral",
  preparing: "active",
  ready: "active",
  filling: "active",
  needs_user: "waiting",
  submitted: "done",
  skipped: "neutral",
  failed: "failed",
  paused: "neutral",
  stopping: "neutral",
  cancelled: "neutral",
  completed: "done",
};

/** Pause takes effect at once for waiting work and after the current step for running work. */
export function canPause(state: WorkState): boolean {
  return state === "queued" || isWorking(state);
}

export function canStop(state: WorkState): boolean {
  return state === "queued" || state === "paused" || isWorking(state);
}

/** The one line under a job's title in the queue table. */
export function queueNote(item: WorkItem): string {
  if (item.state === "needs_user") return "Waiting for your answer";
  if (item.state === "preparing") return "Tailoring your resume and answers";
  if (item.state === "ready") return "Opening the application";
  if (item.state === "filling") return "Filling the application";
  if (item.state === "stopping") return "Finishing the current step";
  if (item.state === "paused") return item.pauseRequestedAt ? "Paused by you" : "Paused";
  if (item.state === "submitted" && item.finishedAt)
    return `Sent ${formatRelativeTime(item.finishedAt)}`;
  if (item.reason && ["failed", "skipped", "cancelled"].includes(item.state)) return item.reason;
  if (item.resumeLabel) return `Using ${item.resumeLabel}`;
  return "Waiting for a free worker";
}

export const QUEUE_VIEWS = [
  { value: "active", label: "Active" },
  { value: "next", label: "Up next" },
  { value: "running", label: "Running" },
  { value: "waiting", label: "Waiting on you" },
  { value: "done", label: "Done" },
  { value: "failed", label: "Failed" },
] as const;

export function isWorking(state: WorkState): boolean {
  return ["preparing", "ready", "filling"].includes(state);
}

/** Preparation and account setup are single-use; the API still refuses work with open questions. */
export function canRetry(state: WorkState, intent?: WorkItem["intent"]): boolean {
  return (
    ["failed", "needs_user", "cancelled"].includes(state) &&
    intent !== "intake_prepare" &&
    intent !== "account_setup"
  );
}

export const QUEUE_WAIT_LABELS: Record<(typeof QUEUE_BLOCK_REASONS)[number], string> = {
  settled_request: "Previously settled request",
  work_not_queued: "Work is not queued",
  capacity: "Worker capacity",
  exclusive_work: "Exclusive work running",
  domain_busy: "Another job on the same site is running",
  domain_pacing: "Spacing out applications on the same site",
  daily_cap: "Daily application limit reached",
  campaign_cap: "Search limit reached",
  company_cap: "Company limit reached",
  campaign_paused: "Search paused",
  questions: "Unanswered questions in Needs you",
  submission_outcome: "Submission outcome unresolved",
  artifact_unavailable: "Resume PDF unavailable",
  pilot_limit: "Pilot limit",
  blocked_site: "This site can't be automated",
  unknown_scope: "Unknown company or site",
  run_limit: "No runs left",
  user_decision: "Waiting for your decision",
  company_excluded: "Excluded company",
};
