"use client";

import { useEffect, useRef } from "react";
import { API_BASE_URL } from "@/api/base-url";
import { api } from "@/api/client";
import { apiErrorMessage } from "@/api/error";
import { getQueueConnectedPreference, patchAgentStorage } from "@/lib/agent-storage";
import { connectQueueCompanion } from "@/lib/queue-companion";
import { useQueueCompanion } from "./use-queue-companion";

/** Connects this computer's queue host to the signed-in account and remembers the choice. */
export async function connectThisComputer(): Promise<void> {
  const result = await api.auth.tokens.terminal.post();
  if (result.error || !result.data) throw new Error(apiErrorMessage(result.error));
  await connectQueueCompanion({
    apiToken: result.data.token,
    apiUrl: API_BASE_URL,
    webUrl: window.location.origin,
  });
  patchAgentStorage({ queueConnected: true });
}

/** A host restart drops its in-memory connection; reconnect from any page unless the person disconnected. */
export function useQueueAutoReconnect(): void {
  const { query, status } = useQueueCompanion();
  const lastAttempt = useRef(0);
  const dropped = !!query.data && !query.data.connected;
  useEffect(() => {
    if (status?.connected && !getQueueConnectedPreference())
      patchAgentStorage({ queueConnected: true });
  }, [status?.connected]);
  useEffect(() => {
    if (!dropped || !getQueueConnectedPreference()) return;
    if (Date.now() - lastAttempt.current < 30_000) return;
    lastAttempt.current = Date.now();
    connectThisComputer()
      .then(() => query.refetch())
      .catch(() => undefined);
  });
}
