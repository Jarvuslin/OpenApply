import type { QueueCompanionStatus } from "@/lib/queue-companion";

export function queueConnectionState(input: {
  pending: boolean;
  error: boolean;
  status?: QueueCompanionStatus;
}) {
  if (input.pending)
    return { label: "Your computer", detail: "Checking connection…", color: "info.main" };
  if (input.error)
    return {
      label: "Connection unavailable",
      detail: "Check the local companion",
      color: "attention.main",
    };
  const status = input.status;
  if (!status?.connected)
    return {
      label: "Not connected",
      detail: "Click to connect",
      color: "text.secondary",
    };
  if (status.lastError || status.blockingReason)
    return {
      label: "Computer needs attention",
      detail: "Review the queue connection",
      color: "attention.main",
    };
  if (status.running)
    return { label: "Your computer", detail: "Connected · working", color: "info.main" };
  // Runs are granted automatically from the queue, so no remaining allocation just means idle.
  if (!status.budget.enabled || status.effectiveCapacity === 0)
    return { label: "Computer connected", detail: "Execution is blocked", color: "attention.main" };
  return { label: "Your computer", detail: "Connected · ready", color: "success.main" };
}
