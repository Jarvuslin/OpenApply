"use client";

import { useMutation, useMutationState, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { apiErrorMessage } from "@/api/error";

interface JobAction {
  slug: string;
  kind: "save" | "unsave" | "apply" | "undo";
}

interface JobState {
  slug: string;
  isSaved: boolean;
  isApplied: boolean;
  canUndoApplied: boolean;
}

interface JobActionResult {
  patch: Partial<Omit<JobState, "slug">>;
  savedCount?: number;
}

export function useDiscoverActions(onError: (message: string) => void) {
  const queryClient = useQueryClient();
  const pending = useMutationState({
    filters: { mutationKey: ["discover-action"], status: "pending" },
    select: (mutation) => mutation.state.variables as JobAction,
  });
  const mutation = useMutation({
    mutationKey: ["discover-action"],
    mutationFn: async ({ slug, kind }: JobAction): Promise<JobActionResult> => {
      if (kind === "save" || kind === "unsave") {
        const endpoint = api.jobs({ slug }).saved;
        const result = kind === "unsave" ? await endpoint.delete() : await endpoint.put();
        if (result.error) throw new Error(apiErrorMessage(result.error));
        return { patch: { isSaved: result.data.isSaved }, savedCount: result.data.savedCount };
      }
      const endpoint = api.jobs({ slug }).applied;
      const result = kind === "undo" ? await endpoint.delete() : await endpoint.put();
      if (result.error) throw new Error(apiErrorMessage(result.error));
      return {
        patch: { isApplied: result.data.isApplied, canUndoApplied: result.data.canUndoApplied },
      };
    },
    onSuccess: async ({ patch, savedCount }, { slug }) => {
      for (const list of ["list", "saved"]) {
        await queryClient.cancelQueries({ queryKey: ["discover", list] });
        queryClient.setQueriesData<{ items: JobState[] }>(
          { queryKey: ["discover", list] },
          (current) =>
            current && {
              ...current,
              items: current.items.map((job) => (job.slug === slug ? { ...job, ...patch } : job)),
            },
        );
      }
      await queryClient.cancelQueries({ queryKey: ["discover", "detail", slug] });
      queryClient.setQueryData<JobState>(["discover", "detail", slug], (current) =>
        current ? { ...current, ...patch } : current,
      );
      if (savedCount !== undefined) {
        queryClient.setQueryData(["discover", "saved-count"], { count: savedCount });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["discover"] }),
        ...(patch.isApplied === undefined
          ? []
          : [queryClient.invalidateQueries({ queryKey: ["applications"] })]),
      ]);
    },
    onError: (error) => onError(error.message),
  });

  function isPending(slug: string, kind: "saved" | "applied"): boolean {
    return pending.some(
      (action) =>
        action.slug === slug &&
        (kind === "saved"
          ? action.kind === "save" || action.kind === "unsave"
          : action.kind === "apply" || action.kind === "undo"),
    );
  }

  function update(slug: string, kind: JobAction["kind"]): void {
    const category = kind === "save" || kind === "unsave" ? "saved" : "applied";
    if (isPending(slug, category)) return;
    onError("");
    mutation.mutate({ slug, kind });
  }

  return { update, isPending };
}
