"use client";

import { type ReactElement, type ReactNode, useState } from "react";
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Divider,
  Link,
  Popover,
  Stack,
  Typography,
} from "@mui/material";
import { BookOpen, ChevronRight, FileText, Laptop } from "lucide-react";
import type { Route } from "next";
import { api } from "@/api/client";
import { apiErrorMessage } from "@/api/error";
import { useApiQuery } from "@/api/hooks";
import { queueQueries } from "@/api/queue-queries";
import { QUEUE_WAIT_LABELS } from "@/components/features/queue/queue-state";
import { LinkButton } from "@/components/ui/buttons";
import { connectThisComputer } from "@/hooks/use-queue-auto-reconnect";
import { useQueueCompanion } from "@/hooks/use-queue-companion";
import { patchAgentStorage } from "@/lib/agent-storage";
import { disconnectQueueCompanion, type QueueCompanionStatus } from "@/lib/queue-companion";

type Health = "checking" | "offline" | "unpaired" | "attention" | "connected";

interface HealthCopy {
  card: string;
  title: string;
  subtitle: string;
  body: string;
  dot: string;
}

const COPY: Record<Health, HealthCopy> = {
  checking: {
    card: "Checking…",
    title: "Checking your computer",
    subtitle: "Looking for the OpenApply app on this computer.",
    body: "This takes a moment after the page loads.",
    dot: "statusDots.neutral",
  },
  offline: {
    card: "Companion offline",
    title: "Local companion offline",
    subtitle: "Unable to reach the app on your computer.",
    body: "Your queued jobs are safe. Applications and pilot scoring resume when the companion reconnects.",
    dot: "statusDots.waiting",
  },
  unpaired: {
    card: "Not connected",
    title: "Companion not connected",
    subtitle: "The app is running on this computer but isn't linked to your account.",
    body: "Connect it so queued applications and pilot scoring can run here.",
    dot: "statusDots.neutral",
  },
  attention: {
    card: "Needs attention",
    title: "Companion needs attention",
    subtitle: "Your computer is connected but can't start work right now.",
    body: "Your queued jobs are safe. Fix the issue below and work resumes on its own.",
    dot: "statusDots.failed",
  },
  connected: {
    card: "Companion online",
    title: "Local companion connected",
    subtitle: "Queued work runs on this computer while it stays connected.",
    body: "",
    dot: "statusDots.done",
  },
};

function healthOf(pending: boolean, error: boolean, status?: QueueCompanionStatus): Health {
  if (pending) return "checking";
  if (error) return "offline";
  if (!status?.connected) return "unpaired";
  if (status.lastError || status.blockingReason) return "attention";
  if (!status.budget.enabled || status.effectiveCapacity === 0) return "attention";
  return "connected";
}

interface LaptopTileProps {
  dot: string;
  size: number;
}

function LaptopTile({ dot, size }: LaptopTileProps): ReactElement {
  return (
    <Box
      sx={(theme) => ({
        position: "relative",
        display: "grid",
        placeItems: "center",
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: theme.radii.md,
        bgcolor: "surfaces.elevated",
        color: "text.primary",
      })}
    >
      <Laptop size={Math.round(size / 2.2)} strokeWidth={1.75} aria-hidden />
      <Box
        sx={{
          position: "absolute",
          top: -3,
          right: -3,
          width: 10,
          height: 10,
          borderRadius: "50%",
          bgcolor: dot,
          border: 2,
          borderColor: "background.paper",
        }}
      />
    </Box>
  );
}

interface DetailsBoxProps {
  children: ReactNode;
}

function DetailsBox({ children }: DetailsBoxProps): ReactElement {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={(theme) => ({
        alignItems: "flex-start",
        px: 1.75,
        py: 1.5,
        borderRadius: theme.radii.md,
        bgcolor: "surfaces.elevated",
      })}
    >
      <Box sx={{ color: "text.secondary", pt: 0.25 }}>
        <FileText size={18} strokeWidth={1.75} aria-hidden />
      </Box>
      <Stack spacing={0.25} sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="captionMuted">Technical details</Typography>
        {children}
      </Stack>
    </Stack>
  );
}

interface DetailLineProps {
  label: string;
  value: string;
}

function DetailLine({ label, value }: DetailLineProps): ReactElement {
  return (
    <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between" }}>
      <Typography variant="body2Muted">{label}</Typography>
      <Typography variant="body2">{value}</Typography>
    </Stack>
  );
}

/** The sidebar's computer card. Clicking it opens the connection details and actions. */
export function CompanionStatus(): ReactElement {
  const { query, status } = useQueueCompanion();
  const limits = useApiQuery(queueQueries.limits(), { retry: false });
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const health = healthOf(query.isPending, query.isError, status);
  const copy = COPY[health];

  async function run(action: () => Promise<unknown>): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      await query.refetch();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update this connection.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(): Promise<void> {
    const ownerId = status?.ownerId;
    const connectionId = status?.connectionId;
    if (!ownerId || !connectionId) return;
    const response = await api.auth.tokens.terminal.post();
    if (response.error || !response.data) throw new Error(apiErrorMessage(response.error));
    await disconnectQueueCompanion({
      apiToken: response.data.token,
      expectedOwnerId: ownerId,
      connectionId,
    });
    patchAgentStorage({ queueConnected: false });
  }

  const busyWorkers = status?.workers.filter((worker) => worker.state !== "stopping").length ?? 0;
  const runsLeft =
    typeof limits.data?.runsRemaining === "number" ? `${limits.data.runsRemaining}` : "No limit";
  const waiting =
    status?.budget.reason && status.budget.reason !== status.blockingReason
      ? (QUEUE_WAIT_LABELS[status.budget.reason as keyof typeof QUEUE_WAIT_LABELS] ??
        status.budget.reason)
      : null;
  let detail = "Connection error";
  if (health === "unpaired") detail = "Not linked to an account";
  if (health === "attention")
    detail = status?.blockingReason ?? status?.lastError ?? "Execution is blocked";
  if (health === "checking") detail = "Checking connection…";
  let cardSubtitle = "Click for connection details";
  if (health === "connected")
    cardSubtitle = status?.running ? "Connected · working" : "Connected · ready";

  return (
    <Stack sx={{ px: 2, py: 1 }}>
      <ButtonBase
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        aria-label={`${copy.card}. ${cardSubtitle}`}
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={(theme) => ({
          gap: 1.25,
          p: 1.25,
          border: 1,
          borderColor: anchor ? "line.borderHi" : "divider",
          borderRadius: theme.radii.lg,
          bgcolor: anchor ? "action.hover" : "background.paper",
          justifyContent: "flex-start",
          textAlign: "left",
          transition: `background-color ${theme.motion.fast}, border-color ${theme.motion.fast}`,
          "&:hover": { bgcolor: "action.hover", borderColor: "line.borderHi" },
          "&:focus-visible": { boxShadow: theme.shadows_custom.focus },
        })}
      >
        <LaptopTile dot={copy.dot} size={36} />
        <Stack spacing={0.25} sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body2Strong" noWrap>
            {copy.card}
          </Typography>
          <Typography variant="captionMuted" noWrap aria-live="polite">
            {cardSubtitle}
          </Typography>
        </Stack>
        <Box sx={{ color: "text.secondary", display: "flex" }}>
          <ChevronRight size={16} aria-hidden />
        </Box>
      </ButtonBase>

      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        // The card sits at the foot of the sidebar, so the details grow upward from it.
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{
          paper: {
            role: "dialog",
            "aria-label": copy.title,
            sx: (theme) => ({
              ml: 1.5,
              width: 360,
              overflow: "visible",
              borderRadius: theme.radii.lg,
              border: 1,
              borderColor: "divider",
              boxShadow: theme.shadows_custom.lg,
              // The little pointer back to the card.
              "&::before": {
                content: '""',
                position: "absolute",
                left: -7,
                bottom: 30,
                width: 12,
                height: 12,
                bgcolor: "background.paper",
                borderLeft: 1,
                borderBottom: 1,
                borderColor: "divider",
                transform: "rotate(45deg)",
              },
            }),
          },
        }}
      >
        <Stack spacing={2} sx={{ p: 2.5 }}>
          <Stack direction="row" spacing={1.75} sx={{ alignItems: "flex-start" }}>
            <LaptopTile dot={copy.dot} size={44} />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h4" component="h2">
                {copy.title}
              </Typography>
              <Typography variant="body2Muted">{copy.subtitle}</Typography>
            </Box>
          </Stack>
          {copy.body && <Typography variant="body2Muted">{copy.body}</Typography>}
          <Divider />
          <DetailsBox>
            {health === "connected" ? (
              <Stack spacing={0.5} sx={{ pt: 0.25 }}>
                <DetailLine
                  label="Working on"
                  value={`${busyWorkers} of ${status?.configuredCapacity ?? 0}`}
                />
                <DetailLine label="Runs left" value={runsLeft} />
                {waiting && <DetailLine label="Waiting" value={waiting} />}
              </Stack>
            ) : (
              <Typography variant="body2">{detail}</Typography>
            )}
          </DetailsBox>
          {error && <Alert severity="error">{error}</Alert>}
          <Divider />
          <Stack direction="row" spacing={1.25}>
            {health === "unpaired" && (
              <Button
                variant="contained"
                fullWidth
                disabled={busy}
                onClick={() => void run(connectThisComputer)}
              >
                {busy ? "Connecting…" : "Connect this computer"}
              </Button>
            )}
            {health !== "unpaired" && (
              <Button
                variant={health === "connected" ? "outlined" : "contained"}
                fullWidth
                disabled={busy || query.isFetching}
                onClick={() => void run(() => Promise.resolve())}
              >
                {health === "connected" ? "Check connection" : "Retry connection"}
              </Button>
            )}
            {health === "connected" ? (
              <Button
                variant="outlined"
                color="error"
                fullWidth
                disabled={busy}
                onClick={() => void run(disconnect)}
              >
                Disconnect
              </Button>
            ) : (
              <LinkButton href={"/install" as Route} variant="outlined" fullWidth>
                Open companion
              </LinkButton>
            )}
          </Stack>
          <Link
            href="/docs/getting-started"
            variant="body2"
            sx={{ display: "flex", alignItems: "center", gap: 1, alignSelf: "flex-start" }}
          >
            <BookOpen size={18} strokeWidth={1.75} aria-hidden />
            View setup help
          </Link>
        </Stack>
      </Popover>
    </Stack>
  );
}
