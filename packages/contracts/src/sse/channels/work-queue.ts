import { defineChannel } from "../channel";

export const workQueueChannel = defineChannel<
  { type: "work-queue.changed"; itemId?: string },
  void,
  { userId: string }
>({ name: "work-queue", path: () => "/api/work-queue/events", topic: ({ userId }) => userId });
