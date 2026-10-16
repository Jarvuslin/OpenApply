"use client";

import {
  createContext,
  type PropsWithChildren,
  type ReactElement,
  useContext,
  useState,
  useSyncExternalStore,
} from "react";
import { getStoredProvider, patchAgentStorage, subscribeAgentStorage } from "@/lib/agent-storage";
import {
  killSession,
  shutdownHost,
  TerminalApiError,
  type TerminalProviderId,
} from "@/lib/terminal";
import { useToast } from "@/providers/notification-provider";

export interface AgentDockContextValue {
  provider: TerminalProviderId;
  switchProvider: (next: TerminalProviderId) => Promise<void>;
  restart: () => Promise<void>;
  /** Resolves true when the host is shutting down, false when it stayed up (failure or legacy fallback). */
  stop: () => Promise<boolean>;
  terminalRevision: number;
  expanded: boolean;
  expand: () => void;
  collapse: () => void;
}

const AgentDockContext = createContext<AgentDockContextValue | null>(null);

export function AgentProvider(props: PropsWithChildren): ReactElement {
  const { children } = props;
  const toast = useToast();

  // localStorage is the source of truth; useSyncExternalStore keeps render in
  // sync, SSR-safe and without a hydration effect.
  const provider = useSyncExternalStore(
    subscribeAgentStorage,
    getStoredProvider,
    (): TerminalProviderId => "claude",
  );

  const [expanded, setExpanded] = useState(false);
  const [terminalRevision, setTerminalRevision] = useState(0);

  // Resolves true only when the host is actually going down, so the dock knows whether to keep its
  // "Stopping…" card up: on every other path the host stays reachable and nothing would ever clear it.
  const stop = async (): Promise<boolean> => {
    try {
      await shutdownHost();
      return true;
    } catch (error) {
      toast.error(
        error instanceof TerminalApiError
          ? `Couldn't stop the terminal: ${error.message}`
          : "The OpenApply agent isn't reachable, so there is nothing to stop.",
      );
      return false;
    }
  };

  // Kill the host session and bump the revision so the TerminalPanel key changes,
  // remounting it with a fresh xterm + a newly started session. A failed kill still
  // remounts - the fresh panel reports the host problem in place.
  const restart = async (): Promise<void> => {
    try {
      await killSession();
    } catch {
      // unreachable or already stopped
    }
    setTerminalRevision((n) => n + 1);
  };

  const switchProvider = async (next: TerminalProviderId): Promise<void> => {
    if (next === provider) {
      return;
    }

    try {
      await killSession();
    } catch {
      // unreachable or already stopped - starting the next provider replaces the session anyway
    }
    patchAgentStorage({ provider: next });
    setTerminalRevision((n) => n + 1);
  };

  const dockValue: AgentDockContextValue = {
    provider,
    switchProvider,
    restart,
    stop,
    terminalRevision,
    expanded,
    expand: () => {
      patchAgentStorage({ advancedTools: true });
      setExpanded(true);
    },
    collapse: () => setExpanded(false),
  };

  return <AgentDockContext.Provider value={dockValue}>{children}</AgentDockContext.Provider>;
}

export function useAgentDock(): AgentDockContextValue {
  const ctx = useContext(AgentDockContext);
  if (!ctx) {
    throw new Error("useAgentDock must be used within an AgentProvider");
  }
  return ctx;
}
