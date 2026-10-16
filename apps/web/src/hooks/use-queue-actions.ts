"use client";

import type { EnqueueCampaignWork } from "@openapply/contracts/work-queue";
import { api } from "@/api/client";
import { ApiError } from "@/api/error";
import { useApiMutation } from "@/api/hooks";
import { invalidations } from "@/api/query-keys";
import { getStoredProvider } from "@/lib/agent-storage";
import { queueRequests, sendQueueRequest } from "@/lib/queue-request";
import { useSession } from "./use-auth";

interface CampaignQueueAction {
  campaignId: string;
  action: EnqueueCampaignWork["action"];
  jobIds?: string[];
}

export function useQueueActions() {
  const { user } = useSession();
  const jobs = useApiMutation(
    async (jobIds: string[]) => {
      const input = {
        jobIds: [...new Set(jobIds)].sort(),
        source: "user" as const,
        provider: getStoredProvider(),
      };
      const data = await sendQueueRequest(
        queueRequests,
        user?.id ?? "",
        ["enqueue", input],
        async (idempotencyKey) => {
          const result = await api["work-queue"].enqueue.post({ ...input, idempotencyKey });
          if (result.error) throw new ApiError(result.error);
          return result.data;
        },
      );
      return { data, error: null };
    },
    {
      invalidate: invalidations.queue,
      retry: false,
      successMessage: "Jobs added to your queue. View progress in Queue.",
    },
  );
  const campaign = useApiMutation(
    async ({ campaignId, action, jobIds }: CampaignQueueAction) => {
      const input = {
        action,
        provider: getStoredProvider(),
        ...(jobIds && { jobIds: [...new Set(jobIds)].sort() }),
      };
      const data = await sendQueueRequest(
        queueRequests,
        user?.id ?? "",
        ["campaign", campaignId, input],
        async (idempotencyKey) => {
          const result = await api["work-queue"]
            .campaign({ id: campaignId })
            .post({ ...input, idempotencyKey });
          if (result.error) throw new ApiError(result.error);
          return result.data;
        },
      );
      return { data, error: null };
    },
    {
      invalidate: invalidations.queue,
      retry: false,
      successMessage: "Campaign work added to your queue.",
    },
  );
  return { jobs, campaign };
}
