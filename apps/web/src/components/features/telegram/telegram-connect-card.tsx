"use client";

import { type ReactElement, useEffect, useRef, useState } from "react";
import { Alert, Box, Button, Chip, Divider, Skeleton, Stack, Typography } from "@mui/material";
import type { TelegramPairing } from "@openapply/contracts/telegram";
import { useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { api } from "@/api/client";
import { ApiError } from "@/api/error";
import { useApiQuery } from "@/api/hooks";
import { queryKeys } from "@/api/query-keys";
import { telegramQueries } from "@/api/telegram-queries";
import { CopyField } from "@/components/ui/display";
import { SectionCard } from "@/components/ui/layout";
import { formatDate } from "@/utils/format";
import {
  connectState,
  formatCountdown,
  readStoredPairing,
  storePairing,
} from "./telegram-connect-state";

interface TelegramConnectCardProps {
  userId: string;
}

export function TelegramConnectCard({ userId }: TelegramConnectCardProps): ReactElement {
  const client = useQueryClient();
  const [stored, setStored] = useState<TelegramPairing | null>(() => readStoredPairing(userId));
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unlinked, setUnlinked] = useState(false);
  const autoStarted = useRef(false);
  const live = !!stored && new Date(stored.expiresAt).getTime() > now;
  const status = useApiQuery(telegramQueries.status(), {
    retry: false,
    // Watch for the phone to finish linking; stops once linked (code cleared), expired or unmounted.
    refetchInterval: live ? 3_000 : false,
  });
  const state = status.data ? connectState(status.data, stored, now) : null;
  const showing = state?.kind === "showing";

  useEffect(() => {
    if (!showing) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [showing]);
  useEffect(() => {
    const sync = () => setStored(readStoredPairing(userId));
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [userId]);
  useEffect(() => {
    if (state?.kind === "connected" && stored) {
      storePairing(userId, null);
      setStored(null);
    }
  }, [state?.kind, stored, userId]);

  async function createCode(): Promise<void> {
    setBusy(true);
    setError("");
    setUnlinked(false);
    try {
      const result = await api.telegram.pairing.post({ requestId: crypto.randomUUID() });
      if (result.error) throw new ApiError(result.error);
      storePairing(userId, result.data);
      setStored(result.data);
      setNow(Date.now());
    } catch {
      setError("Couldn't create a code. Check your connection and try again.");
    } finally {
      await client.invalidateQueries({ queryKey: queryKeys.telegram.status() });
      setBusy(false);
    }
  }

  async function unlink(linkId: string): Promise<void> {
    setBusy(true);
    setError("");
    try {
      const result = await api.telegram.delete({ expectedLinkId: linkId });
      if (result.error) throw new ApiError(result.error);
      storePairing(userId, null);
      setStored(null);
      setUnlinked(true);
    } catch {
      setError("Couldn't disconnect Telegram. Try again.");
    } finally {
      await client.invalidateQueries({ queryKey: queryKeys.telegram.status() });
      setBusy(false);
    }
  }

  // Opening the tab with nothing connected starts a code once; never after an unlink.
  useEffect(() => {
    if (state?.kind !== "idle" || autoStarted.current || unlinked) return;
    autoStarted.current = true;
    void createCode();
  });

  return (
    <SectionCard
      title="Telegram"
      description="Get updates and answer questions from Telegram on your phone."
      actions={
        state?.kind === "connected" && <Chip size="small" color="success" label="Connected" />
      }
    >
      <Stack spacing={2}>
        {error && (
          <Alert
            severity="error"
            action={
              <Button color="inherit" disabled={busy} onClick={() => void createCode()}>
                Retry
              </Button>
            }
          >
            {error}
          </Alert>
        )}
        {status.error && !status.data && (
          <Alert
            severity="error"
            action={
              <Button color="inherit" onClick={() => void status.refetch()}>
                Retry
              </Button>
            }
          >
            Couldn't load your Telegram connection.
          </Alert>
        )}
        {!state && !status.error && <Skeleton variant="rounded" height={180} />}
        {state?.kind === "not_configured" && (
          <Typography variant="body1Muted">
            Telegram isn't set up on this server yet. An administrator needs to add the bot.
          </Typography>
        )}
        {state?.kind === "connected" && (
          <Stack
            direction="row"
            spacing={2}
            sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1.5 }}
          >
            <Stack spacing={0.25} sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body1Strong">{state.label}</Typography>
              <Typography variant="body2Muted">Since {formatDate(state.linkedAt)}</Typography>
            </Stack>
            <Button
              variant="outlined"
              disabled={busy}
              onClick={() => status.data?.link && void unlink(status.data.link.id)}
            >
              Unlink
            </Button>
          </Stack>
        )}
        {state?.kind === "showing" && status.data?.botUsername && (
          <PairingPanel
            pairing={state.pairing}
            botUsername={status.data.botUsername}
            secondsLeft={state.secondsLeft}
            busy={busy}
            onNewCode={() => void createCode()}
          />
        )}
        {(state?.kind === "idle" || state?.kind === "elsewhere" || state?.kind === "expired") && (
          <Stack
            direction="row"
            spacing={2}
            sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1.5 }}
          >
            <Typography variant="body1Muted" sx={{ flex: 1, minWidth: 0 }}>
              {state.kind === "expired" && "That code expired. Get a new one to connect."}
              {state.kind === "elsewhere" &&
                "A code is open in another browser. Get a new one here to connect from this one."}
              {state.kind === "idle" && busy && "Getting your code…"}
              {state.kind === "idle" &&
                !busy &&
                (unlinked ? "Telegram is disconnected." : "Telegram isn't connected yet.")}
            </Typography>
            <Button variant="contained" loading={busy} onClick={() => void createCode()}>
              {state.kind === "idle" ? "Connect Telegram" : "Get a new code"}
            </Button>
          </Stack>
        )}
      </Stack>
    </SectionCard>
  );
}

interface PairingPanelProps {
  pairing: TelegramPairing;
  botUsername: string;
  secondsLeft: number;
  busy: boolean;
  onNewCode: () => void;
}

function PairingPanel(props: PairingPanelProps): ReactElement {
  const { pairing, botUsername, secondsLeft, busy, onNewCode } = props;
  return (
    <Stack spacing={2.5} data-private-pairing>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={3}
        sx={{ alignItems: { sm: "center" } }}
      >
        <Box
          data-telegram-qr={pairing.startUrl}
          sx={(theme) => ({
            p: 1.5,
            alignSelf: { xs: "center", sm: "auto" },
            border: 1,
            borderColor: "line.border",
            borderRadius: theme.radii.lg,
            bgcolor: "common.white",
            lineHeight: 0,
          })}
        >
          <QRCodeSVG
            value={pairing.startUrl}
            size={156}
            marginSize={0}
            title="Telegram connect code"
          />
        </Box>
        <Stack spacing={1}>
          <Typography variant="h4" component="h3">
            Scan with your phone's camera
          </Typography>
          <Typography variant="body1Muted">
            Telegram opens to @{botUsername}. Tap Start and you're connected. This page updates by
            itself.
          </Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", pt: 0.5 }}>
            <Typography variant="body2Muted" aria-live="polite">
              Code expires in {formatCountdown(secondsLeft)}
            </Typography>
            <Button size="small" disabled={busy} onClick={onNewCode}>
              Get a new code
            </Button>
          </Stack>
        </Stack>
      </Stack>
      <Divider />
      <Stack spacing={1.5}>
        <Typography variant="body2Strong">Connect manually</Typography>
        <Box
          component="ol"
          sx={{ m: 0, pl: 2.5, color: "text.secondary", typography: "body2", "& li": { mb: 0.25 } }}
        >
          <li>Open Telegram on your phone.</li>
          <li>Search for @{botUsername} and tap Start.</li>
          <li>Send this code in the chat.</li>
          <li>You're connected.</li>
        </Box>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <CopyField
              value={`@${botUsername}`}
              ariaLabel="Copy bot username"
              copyMessage="Bot username copied"
            />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <CopyField value={pairing.code} ariaLabel="Copy code" copyMessage="Code copied" />
          </Box>
        </Stack>
      </Stack>
    </Stack>
  );
}
