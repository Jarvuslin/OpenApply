"use client";

import type { ReactNode } from "react";
import { useQueueAutoReconnect } from "@/hooks/use-queue-auto-reconnect";

export function QueueAutoReconnect(): ReactNode {
  useQueueAutoReconnect();
  return null;
}
