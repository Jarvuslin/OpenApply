"use client";

import { useMutation, useMutationState, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { ApiError } from "@/api/error";
import { invalidations } from "@/api/query-keys";
import { useSession } from "@/hooks/use-auth";
import { getStoredProvider } from "@/lib/agent-storage";
import { queueRequests, sendQueueRequest } from "@/lib/queue-request";
import { useToast } from "@/providers/notification-provider";

/** Adds one job to the queue, reusing the same idempotent request as the bulk saved-jobs flow. */
export function useAddToQueue() {
  const { user } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const pending = useMutationState({
    filters: { mutationKey: ["add-to-queue"], status: "pending" },
    select: (mutation) => mutation.state.variables as string,
  });
  const mutation = useMutation({
    mutationKey: ["add-to-queue"],
    mutationFn: async (slug: string) => {
      const provider = getStoredProvider();
      const result = await sendQueueRequest(
        queueRequests,
        user?.id ?? "",
        ["mvp.apply", [slug], provider],
        async (idempotencyKey) => {
          const response = await api.mvp.apply.post({ slugs: [slug], idempotencyKey, provider });
          if (response.error) throw new ApiError(response.error);
          return response.data;
        },
      );
      if (!result) throw new Error("The queue did not confirm this job. Try again.");
      return result;
    },
    onSuccess: async (result) => {
      const skipped = result.skipped[0];
      if (skipped) toast.error(`Not added: ${skipped.reason}`);
      else toast.success("Added to your queue.", { label: "Open queue", href: "/queue" });
      for (const queryKey of invalidations.queue) await queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => toast.error(error.message),
  });
  return {
    add: (slug: string) => mutation.mutate(slug),
    isPending: (slug: string) => pending.includes(slug),
  };
}
