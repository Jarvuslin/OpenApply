"use client";

import type { AnyChannel, ChannelEvent, ChannelUrlParams } from "@openapply/contracts/sse";
import { useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "@/api/base-url";
import { useSession } from "@/hooks/use-auth";
import { acquireSource } from "./browser-transport";
import type { ConnectionStatus } from "./shared-transport";
import { subscribeWhileVisible } from "./visibility-subscription";

/** "waiting" is scheduled capacity sharing; "reconnecting" means a transport failure. */
export type SseConnectionStatus = ConnectionStatus;

/**
 * Hook input for a channel's URL params. Channels with no URL params
 * (`TUrlParams = void`) take `null` at the call site as an explicit "no
 * params" marker; typed channels still require their full param object.
 */
type UrlParamsArg<C extends AnyChannel> =
  // biome-ignore lint/suspicious/noConfusingVoidType: probes the `TUrlParams = void` channels declare
  void extends ChannelUrlParams<C> ? null : ChannelUrlParams<C>;

interface UseEventSourceOptions<TEvent> {
  /** When false, the hook stays mounted without opening a connection. */
  enabled?: boolean;
  /** Convert the raw `data` string into the event. Defaults to `JSON.parse`. */
  parse?: (data: string) => TEvent;
  /** Called for each parsed message. */
  onMessage?: (event: TEvent, raw: MessageEvent<string>) => void;
  /** Called when EventSource reports a connection error or reconnect attempt. */
  onError?: (event: Event) => void;
  /** Called when `parse` throws for an incoming message. */
  onParseError?: (error: unknown, raw: MessageEvent<string>) => void;
}

function parseJson<TEvent>(data: string): TEvent {
  return JSON.parse(data) as TEvent;
}

/**
 * Subscribe to a raw SSE stream by URL. Prefer {@link useSseChannel} when
 * you have a channel descriptor; reach for this only when the URL is dynamic
 * or you want fully opaque message handling.
 */
function useEventSource<TEvent = unknown>(
  url: string | null | undefined,
  options: UseEventSourceOptions<TEvent> = {},
): SseConnectionStatus {
  const { user } = useSession();
  const scope = user?.id;
  const [status, setStatus] = useState<SseConnectionStatus>("idle");
  const parseRef = useRef(options.parse ?? parseJson<TEvent>);
  const onMessageRef = useRef(options.onMessage);
  const onErrorRef = useRef(options.onError);
  const onParseErrorRef = useRef(options.onParseError);

  useEffect(() => {
    parseRef.current = options.parse ?? parseJson<TEvent>;
    onMessageRef.current = options.onMessage;
    onErrorRef.current = options.onError;
    onParseErrorRef.current = options.onParseError;
  }, [options.parse, options.onMessage, options.onError, options.onParseError]);

  useEffect(() => {
    if (options.enabled === false || !url || !scope) {
      setStatus("idle");
      return;
    }

    const onRawMessage = (event: MessageEvent<string>) => {
      try {
        onMessageRef.current?.(parseRef.current(event.data), event);
      } catch (err) {
        onParseErrorRef.current?.(err, event);
      }
    };
    const onRawError = (event: Event) => {
      onErrorRef.current?.(event);
    };
    return subscribeWhileVisible(
      document,
      () => acquireSource(scope, url, onRawMessage, onRawError, setStatus),
      () => setStatus("idle"),
    );
  }, [url, scope, options.enabled]);

  return status;
}

type SseHandlers<TEvent extends { type: string }> = Partial<{
  [K in TEvent["type"]]: (event: Extract<TEvent, { type: K }>) => void;
}>;

interface UseSseChannelOptions<TEvent extends { type: string }> {
  /** When false, the hook stays mounted without opening a connection. */
  enabled?: boolean;
  /** Called for every event, regardless of type. Fires before `on[type]`. */
  onMessage?: (event: TEvent) => void;
  /** Per-event-type handlers. Exhaustively type-checked against the channel's event union. */
  on?: SseHandlers<TEvent>;
}

/**
 * Subscribe to a typed channel. The URL is the descriptor's API-relative path
 * against the API origin; `on` dispatches by `event.type` with full type
 * narrowing per variant.
 */
export function useSseChannel<C extends AnyChannel>(
  channel: C,
  params: UrlParamsArg<C>,
  options: UseSseChannelOptions<ChannelEvent<C>> = {},
): SseConnectionStatus {
  type TEvent = ChannelEvent<C>;
  const url =
    options.enabled === false
      ? null
      : `${API_BASE_URL}${channel.path(params as ChannelUrlParams<C>)}`;

  return useEventSource<TEvent>(url, {
    enabled: options.enabled,
    onMessage: (event) => {
      options.onMessage?.(event);
      const handler = options.on?.[event.type as TEvent["type"]] as (e: TEvent) => void;
      handler?.(event);
    },
  });
}
