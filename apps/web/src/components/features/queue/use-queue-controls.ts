"use client";

import { api } from "@/api/client";
import { useApiMutation } from "@/api/hooks";
import { invalidations } from "@/api/query-keys";
import type { QueueItemDto } from "@/api/queue-queries";
import { useConfirm } from "@/providers/confirm-provider";
import { isWorking } from "./queue-state";

type ControlAction = "pause" | "resume" | "stop";

const SUCCESS: Record<ControlAction, string> = {
  pause: "Paused",
  resume: "Queued again",
  stop: "Stopping",
};

export function useQueueControls(item: QueueItemDto) {
  const confirm = useConfirm();
  const control = useApiMutation<unknown, ControlAction>(
    (action) => api["work-queue"]({ id: item.id }).control.post({ action }),
    {
      invalidate: invalidations.queue,
      retry: false,
      successMessage: (_, action) => SUCCESS[action],
    },
  );
  const remove = useApiMutation(() => api["work-queue"]({ id: item.id }).delete(), {
    invalidate: invalidations.queue,
    retry: false,
    successMessage: isWorking(item.state) ? "Stopping. Remove it again once it stops." : "Removed",
  });

  async function stop(): Promise<void> {
    const ok = await confirm({
      title: `Stop ${item.title}?`,
      description: isWorking(item.state)
        ? "The agent finishes its current step, then stops. Nothing is submitted after that."
        : "It won't run. You can retry it later.",
      confirmLabel: "Stop",
      destructive: true,
    });
    if (ok) control.mutate("stop");
  }

  async function confirmRemove(): Promise<void> {
    const ok = await confirm({
      title: `Remove ${item.title}?`,
      description: isWorking(item.state)
        ? "It is running now. It will stop first, then you can remove it."
        : "It leaves your queue. Any application already sent stays in Applications.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (ok) remove.mutate();
  }

  return {
    pause: () => control.mutate("pause"),
    resume: () => control.mutate("resume"),
    stop,
    remove: confirmRemove,
    busy: control.isPending || remove.isPending,
    error: control.error ?? remove.error,
  };
}
