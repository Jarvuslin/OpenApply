"use client";

import type { TerminalProviderId } from "@/lib/terminal";
import { readLocalStorage, writeLocalStorage } from "@/utils/local-storage";

const STORAGE_KEY = "openapply:agent";

interface AgentStorage {
  provider: TerminalProviderId;
  dockWidth: number;
  advancedTools: boolean;
  /** True once a local terminal host has ever answered /healthz from this browser. */
  everReachable: boolean;
  /** Last-reported host capability: the openapply:// scheme is registered, so it can be relaunched from the browser. */
  canRelaunch: boolean;
  /** True between Connect and Disconnect, so a restarted host reconnects by itself. */
  queueConnected: boolean;
}

const storageListeners = new Set<() => void>();

function emitAgentStorageChange(): void {
  for (const listener of storageListeners) {
    listener();
  }
}

let crossTabListenerAttached = false;
function ensureCrossTabListener(): void {
  if (crossTabListenerAttached || typeof window === "undefined") {
    return;
  }
  crossTabListenerAttached = true;
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) {
      emitAgentStorageChange();
    }
  });
}

export function patchAgentStorage(patch: Partial<AgentStorage>): void {
  const current = readLocalStorage<Partial<AgentStorage>>(STORAGE_KEY) ?? {};
  writeLocalStorage(STORAGE_KEY, { ...current, ...patch });
  emitAgentStorageChange();
}

export function readAgentStorage(): Partial<AgentStorage> | null {
  return readLocalStorage<Partial<AgentStorage>>(STORAGE_KEY);
}

/** Subscribe to agent-storage changes - same-tab patches and cross-tab writes. */
export function subscribeAgentStorage(listener: () => void): () => void {
  ensureCrossTabListener();
  storageListeners.add(listener);
  return () => {
    storageListeners.delete(listener);
  };
}

export function getStoredProvider(): TerminalProviderId {
  const p = readAgentStorage()?.provider;
  return p === "codex" || p === "claude" ? p : "claude";
}

export function getAdvancedToolsEnabled(): boolean {
  return readAgentStorage()?.advancedTools ?? false;
}

export function getQueueConnectedPreference(): boolean {
  return readAgentStorage()?.queueConnected ?? false;
}
