import type { Data } from "@openapply/api-client";
import type { api } from "@/api/client";

/** An inbox message, from `GET /api/email/messages`. */
export type EmailMessageDto = Data<typeof api.email.messages.get>["items"][number];

/** Sync result, from `POST /api/email/sync`. */
export type SyncResultDto = Data<typeof api.email.sync.post>;
