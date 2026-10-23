import type { FeedAlert } from "@/generated/prisma/client";

/** Failed refreshes in a row before a feed alerts. */
export const FAILURE_LIMIT = 3;

/**
 * The alert a successful refresh raises against the last successful one: a board that had jobs
 * and now lists none, or one that lost more than half of them at once.
 */
export function refreshAlert(previous: number | null, fetched: number): FeedAlert | null {
  if (!previous) return null;
  if (fetched === 0) return "empty";
  return fetched < previous / 2 ? "dropped" : null;
}
