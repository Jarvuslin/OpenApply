import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";

// Polling one surface must not consume another route's read allowance.
export function createQueueReadLimits() {
  return {
    ordered: rateLimit(RATE_LIMITS.workQueueRead),
    observer: rateLimit(RATE_LIMITS.workQueueObserver),
    limits: rateLimit(RATE_LIMITS.workQueueRead),
    estimate: rateLimit(RATE_LIMITS.workQueueRead),
    list: rateLimit(RATE_LIMITS.workQueueRead),
    summary: rateLimit(RATE_LIMITS.workQueueRead),
    detail: rateLimit(RATE_LIMITS.workQueueRead),
  };
}
