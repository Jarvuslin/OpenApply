import { SourceResponseError } from "./http";
import type { BoardOptions, SourceJob } from "./types";

/** Detail pages cost one request each, so a large board is described over several refreshes. */
const DEFAULT_BUDGET = 200;

/**
 * Fill in jobs from their detail pages, newest first, skipping jobs whose description is already
 * indexed. A failed page leaves its job as listed; a rate limit or robots refusal stops the rest.
 */
export async function withDetails(
  jobs: SourceJob[],
  options: BoardOptions,
  detail: (job: SourceJob) => Promise<Partial<SourceJob>>,
): Promise<void> {
  const described = options.describedUrls
    ? await options.describedUrls(jobs.map((job) => job.url))
    : new Set<string>();
  const pending = jobs
    .filter((job) => !described.has(job.url))
    .sort((a, b) => (b.postedAt?.getTime() ?? 0) - (a.postedAt?.getTime() ?? 0))
    .slice(0, options.detailBudget ?? DEFAULT_BUDGET);
  for (const job of pending) {
    try {
      Object.assign(job, await detail(job));
    } catch (error) {
      if (
        error instanceof SourceResponseError &&
        (error.upstreamStatus === 429 || error.upstreamStatus === null)
      )
        return;
    }
  }
}
