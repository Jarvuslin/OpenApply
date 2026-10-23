export interface ApplicationPlan {
  remainingSlugs: string[];
  campaignId: string | null;
  workItemIds: string[];
  queued: number;
  skipped: string[];
}

interface QueueResult {
  campaignId: string;
  queued: string[];
  skipped: Array<{ slug: string; reason: string }>;
  workItemIds: string[];
}

export async function queueSelectedJobs(
  plan: ApplicationPlan,
  enqueue: (slugs: string[]) => Promise<QueueResult>,
  progress: (remaining: ApplicationPlan) => void,
): Promise<ApplicationPlan> {
  let current = plan;
  while (current.remainingSlugs.length) {
    const batch = current.remainingSlugs.slice(0, 100);
    const result = await enqueue(batch);
    current = {
      remainingSlugs: current.remainingSlugs.slice(batch.length),
      campaignId: result.campaignId,
      workItemIds: [...new Set([...current.workItemIds, ...result.workItemIds])],
      queued: current.queued + result.queued.length,
      skipped: [...current.skipped, ...result.skipped.map((item) => item.reason)],
    };
    progress(current);
  }
  return current;
}
