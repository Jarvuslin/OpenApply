import type { QueueLimits } from "@openapply/contracts/work-queue-limits";
import { updateQueueLimitsSchema } from "@openapply/contracts/work-queue-limits";
import type { z } from "zod/v4";

export const queueLimitsDraftSchema = updateQueueLimitsSchema.omit({
  requestId: true,
  expectedRevision: true,
});
type QueueLimitsDraft = z.infer<typeof queueLimitsDraftSchema>;

export function queueLimitsDraft(limits: QueueLimits): QueueLimitsDraft {
  return queueLimitsDraftSchema.parse({
    maxConcurrentWorkers: limits.maxConcurrentWorkers,
    dailyApplicationCap: limits.dailyApplicationCap,
    companyApplicationCap: limits.companyApplicationCap,
    companyWindowDays: limits.companyWindowDays,
    domainDelaySeconds: limits.domainDelaySeconds,
    runsRemaining: limits.runsRemaining,
    autoRetryFailed: limits.autoRetryFailed ?? false,
  });
}

export function queueLimitsInput(
  draft: QueueLimitsDraft,
  basis: QueueLimits,
  current: QueueLimits,
) {
  if (basis.revision !== current.revision)
    throw new Error("Queue limits changed. Reload the saved limits before saving.");
  return { ...queueLimitsDraftSchema.parse(draft), expectedRevision: basis.revision };
}
