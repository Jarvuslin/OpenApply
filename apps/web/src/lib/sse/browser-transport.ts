import { EventSource } from "eventsource";
import {
  type ConnectionStatus,
  createSharedTransport,
  type StreamSource,
  type TransportChannel,
} from "./shared-transport";

const transports = new Map<string, ReturnType<typeof createSharedTransport>>();

export function resetSseTransport() {
  for (const transport of transports.values()) transport.dispose();
  transports.clear();
}

function openSource(url: string, lastEventId: string): StreamSource {
  const source = new EventSource(url, {
    withCredentials: true,
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      if (lastEventId && !headers.has("Last-Event-ID")) headers.set("Last-Event-ID", lastEventId);
      return fetch(input, { ...init, headers });
    },
  });
  const port: StreamSource = {
    get readyState() {
      return source.readyState;
    },
    CLOSED: source.CLOSED,
    onmessage: null,
    onopen: null,
    onerror: null,
    close: () => source.close(),
  };
  source.onmessage = (event) => port.onmessage?.(event);
  source.onopen = () => port.onopen?.();
  source.onerror = () => port.onerror?.();
  return port;
}

export function acquireSource(
  scope: string,
  url: string,
  onMessage: (event: MessageEvent<string>) => void,
  onError: (event: Event) => void,
  onStatus: (status: ConnectionStatus) => void,
): () => void {
  if (!navigator.locks || typeof BroadcastChannel === "undefined") {
    onStatus("reconnecting");
    onError(new Event("error"));
    return () => {};
  }
  let transport = transports.get(scope);
  if (!transport) {
    transport = createSharedTransport({
      scope,
      locks: navigator.locks,
      channel: (name) => {
        const channel = new BroadcastChannel(name);
        const port: TransportChannel = {
          onmessage: null,
          postMessage: (value) => channel.postMessage(value),
          close: () => {
            channel.onmessage = null;
            channel.close();
          },
        };
        channel.onmessage = (event) => port.onmessage?.({ data: event.data });
        return port;
      },
      open: openSource,
    });
    transports.set(scope, transport);
  }
  return transport.subscribe(url, {
    message: (event) => onMessage(new MessageEvent("message", event)),
    error: () => onError(new Event("error")),
    status: onStatus,
  });
}
