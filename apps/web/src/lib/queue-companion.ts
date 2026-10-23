import { z } from "zod/v4";
import { terminalRequest } from "./terminal-request";

const COMPANION_URL = process.env.NEXT_PUBLIC_TERMINAL_URL ?? "http://localhost:4102";
const statusSchema = z.object({
  ownerId: z.uuid().nullable(),
  connectionId: z.uuid().nullable(),
  connected: z.boolean(),
  running: z.boolean(),
  blockingReason: z.string().nullable(),
  lastError: z.string().nullable(),
  configuredCapacity: z.number().int().min(1).max(3),
  effectiveCapacity: z.number().int().min(0).max(3),
  workers: z.array(
    z.object({
      workerId: z.string(),
      slot: z.number().int().min(1).max(3),
      workItemId: z.string(),
      executionId: z.string(),
      browserSessionId: z.string(),
      state: z.enum(["starting", "running", "stopping", "quarantined"]),
    }),
  ),
  budget: z.object({
    enabled: z.boolean(),
    remainingAllocations: z.number().int().min(0),
    reason: z.string().nullable(),
  }),
});

export type QueueCompanionStatus = z.infer<typeof statusSchema>;
export type QueueWorker = QueueCompanionStatus["workers"][number];

const frameSchema = z.object({
  workItemId: z.uuid(),
  executionId: z.uuid(),
  browserSessionId: z.uuid(),
  capturedAt: z.iso.datetime({ offset: true }),
  mimeType: z.literal("image/jpeg"),
  imageBase64: z
    .string()
    .min(4)
    .max(853_336)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  width: z.number().int().positive().max(4096),
  height: z.number().int().positive().max(4096),
});

export async function getQueueFrame(worker: QueueWorker, token: string, signal: AbortSignal) {
  const params = new URLSearchParams({
    workItemId: worker.workItemId,
    executionId: worker.executionId,
  });
  return terminalRequest(
    `${COMPANION_URL}/queue/workers/${encodeURIComponent(worker.browserSessionId)}/frame?${params}`,
    { method: "GET", headers: { authorization: `Bearer ${token}` }, cache: "no-store" },
    async (response) => {
      if (!response.ok)
        throw new Error(
          "The worker view is unavailable. Its application state is unchanged by this view.",
        );
      const reader = response.body?.getReader();
      if (!reader) throw new Error("The worker returned an empty view.");
      const decoder = new TextDecoder();
      let content = "";
      let bytes = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 900_000) throw new Error("The worker view exceeded its size limit.");
          content += decoder.decode(part.value, { stream: true });
        }
        content += decoder.decode();
      } finally {
        await reader.cancel();
      }
      const frame = frameSchema.parse(JSON.parse(content));
      if (
        frame.workItemId !== worker.workItemId ||
        frame.executionId !== worker.executionId ||
        frame.browserSessionId !== worker.browserSessionId
      )
        throw new Error("The worker changed. Reopen its current view.");
      const age = Date.now() - Date.parse(frame.capturedAt);
      if (age < -10_000 || age > 30_000)
        throw new Error("The worker view is stale. Reopen its current view.");
      return frame;
    },
    { signal, timeoutMs: 8_000 },
  );
}

async function requestStatus(path: string, init: RequestInit): Promise<QueueCompanionStatus> {
  return terminalRequest(
    `${COMPANION_URL}${path}`,
    init,
    async (response) => {
      if (!response.ok) throw new Error("The computer could not update its queue connection.");
      return statusSchema.parse(await response.json());
    },
    { timeoutMs: 8_000 },
  );
}

export function getQueueCompanion(): Promise<QueueCompanionStatus> {
  return requestStatus("/queue/status", { method: "GET" });
}

export function connectQueueCompanion(input: {
  apiToken: string;
  apiUrl: string;
  webUrl: string;
}): Promise<QueueCompanionStatus> {
  return requestStatus("/queue/connect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function disconnectQueueCompanion(input: {
  apiToken: string;
  expectedOwnerId: string;
  connectionId: string;
}): Promise<QueueCompanionStatus> {
  const query = new URLSearchParams({
    expectedOwnerId: input.expectedOwnerId,
    connectionId: input.connectionId,
  });
  return requestStatus(`/queue/connection?${query}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${input.apiToken}` },
  });
}
