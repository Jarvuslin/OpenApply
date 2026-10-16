import { defineChannel } from "../channel";

export const needsYouChannel = defineChannel<
  { type: "needs-you.changed"; jobId?: string },
  void,
  { userId: string }
>({
  name: "needs-you",
  path: () => "/api/needs-you/events",
  topic: ({ userId }) => userId,
});
