import { pilotDrafts } from "../pilot-drafts";
import { settingsDrafts } from "../settings-drafts";
import { resetSseTransport } from "./browser-transport";
import type { TransportChannel } from "./shared-transport";

export function createSessionBoundary(channel: TransportChannel, reset: () => void) {
  const listeners = new Set<(remote: boolean) => void>();
  const changed = (remote: boolean) => {
    reset();
    for (const listener of listeners) listener(remote);
  };
  channel.onmessage = ({ data }) => {
    if (data === "session.changed") changed(true);
  };
  return {
    subscribe(listener: (remote: boolean) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    announce() {
      changed(false);
      channel.postMessage("session.changed");
    },
    dispose() {
      channel.onmessage = null;
      channel.close();
      listeners.clear();
    },
  };
}

let boundary: ReturnType<typeof createSessionBoundary> | undefined;

function clearLocalSession() {
  settingsDrafts.clear();
  pilotDrafts.clear();
  resetSseTransport();
}

function browserBoundary() {
  if (typeof BroadcastChannel === "undefined") return undefined;
  if (!boundary) {
    const channel = new BroadcastChannel("openapply:session-boundary:v1");
    const port: TransportChannel = {
      onmessage: null,
      postMessage: (value) => channel.postMessage(value),
      close: () => {
        channel.onmessage = null;
        channel.close();
      },
    };
    channel.onmessage = (event) => port.onmessage?.({ data: event.data });
    boundary = createSessionBoundary(port, clearLocalSession);
  }
  return boundary;
}

export function announceSessionChange() {
  const current = browserBoundary();
  if (current) current.announce();
  else clearLocalSession();
}

export function observeSessionChanges(listener: (remote: boolean) => void) {
  const current = browserBoundary();
  if (!current) return () => {};
  return current.subscribe(listener);
}
