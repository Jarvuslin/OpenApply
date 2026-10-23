"use client";

import { type ReactNode, useEffect, useState } from "react";
import { FormControlLabel, Switch, Tooltip } from "@mui/material";
import type { PushSubscriptionDto, PushSubscriptionInput } from "@openapply/contracts/push";
import { api } from "@/api/client";
import { useApiMutation, useApiQuery } from "@/api/hooks";
import { pilotQueries } from "@/api/queries";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/providers/notification-provider";
import { urlBase64ToUint8Array } from "@/utils/base64";

/** Push alerts for this browser, toggled from the sidebar. */
export function NotificationSwitch(): ReactNode {
  const toast = useToast();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const publicKey = useApiQuery(pilotQueries.pushKey()).data?.publicKey ?? null;
  const subscribe = useApiMutation<PushSubscriptionDto, PushSubscriptionInput>(
    (input) => api.push.subscriptions.post(input),
    { invalidate: [queryKeys.pilot.push()] },
  );
  const remove = useApiMutation<{ deleted: string }, string>(
    (value) => api.push.subscriptions.delete({ endpoint: value }),
    { invalidate: [queryKeys.pilot.push()] },
  );

  useEffect(() => {
    const ok = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSupported(ok);
    if (!ok) return;
    setPermission(Notification.permission);
    // getRegistration/getSubscription reject in some privacy modes; read that as "off".
    let alive = true;
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => sub?.endpoint ?? null)
      .catch(() => null)
      .then((value) => {
        if (alive) setEndpoint(value);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function turnOn(): Promise<void> {
    if (!publicKey) return;
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth)
      throw new Error("Incomplete push subscription");
    await subscribe.mutateAsync({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      userAgent: navigator.userAgent,
    });
    setEndpoint(sub.endpoint);
  }

  async function turnOff(current: string): Promise<void> {
    // Server first: unsubscribing locally mints a new endpoint, which would orphan the saved row.
    await remove.mutateAsync(current);
    const reg = await navigator.serviceWorker.getRegistration();
    await (await reg?.pushManager.getSubscription())?.unsubscribe();
    setEndpoint(null);
  }

  async function toggle(): Promise<void> {
    setBusy(true);
    try {
      if (endpoint) await turnOff(endpoint);
      else await turnOn();
    } catch {
      toast.error("Could not change notifications on this device.");
    } finally {
      if ("Notification" in window) setPermission(Notification.permission);
      setBusy(false);
    }
  }

  if (supported === null) return null;
  let reason: string | null = null;
  if (!publicKey) reason = "Notifications aren't set up on this server.";
  else if (!supported) reason = "This browser doesn't support notifications.";
  else if (permission === "denied") reason = "Notifications are blocked in your browser settings.";
  return (
    <Tooltip title={reason ?? "Get an alert when something needs you, even with this tab closed."}>
      <FormControlLabel
        sx={{ px: 2, py: 0.5, mr: 0 }}
        control={
          <Switch
            size="small"
            checked={endpoint !== null}
            disabled={busy || reason !== null}
            onChange={() => void toggle()}
          />
        }
        label="Notifications"
        slotProps={{ typography: { variant: "body2" } }}
      />
    </Tooltip>
  );
}
