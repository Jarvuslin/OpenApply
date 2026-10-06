"use client";

import { type ReactElement, useEffect, useState } from "react";
import { Alert, Button, Chip, Drawer, Stack, Typography } from "@mui/material";
import dynamic from "next/dynamic";
import { api } from "@/api/client";
import { apiErrorMessage } from "@/api/error";
import { useApiMutation, useApiQuery } from "@/api/hooks";
import { emailQueries } from "@/api/queries";
import { queryKeys } from "@/api/query-keys";
import { LinkButton } from "@/components/ui/buttons";
import { LoadingSpinner } from "@/components/ui/feedback";
import { SectionCard } from "@/components/ui/layout/section-card";
import { formatSkillCommand, getStatus, injectCommand, providerDisplayName } from "@/lib/terminal";
import { useAgentAvailable, useAgentDock } from "@/providers/agent-provider";
import { useConfirm } from "@/providers/confirm-provider";
import { formatAbsoluteTime } from "@/utils/format";
import { connectorUpdated } from "./connector-updated";

const DockPanel = dynamic(
  () => import("@/components/features/agent-dock/dock-panel").then((module) => module.DockPanel),
  { ssr: false },
);

interface ConnectionCheck {
  provider: string;
  previousSync: string | Date | null;
}

export function ConnectCard(): ReactElement {
  const dock = useAgentDock();
  const confirm = useConfirm();
  const desktop = useAgentAvailable();
  const [compactAgentOpen, setCompactAgentOpen] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [check, setCheck] = useState<ConnectionCheck | null>(null);
  const [notice, setNotice] = useState<{
    severity: "info" | "success" | "warning" | "error";
    text: string;
  } | null>(null);
  const account = useApiQuery(emailQueries.account(), {
    refetchInterval: check ? 4_000 : false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const disconnect = useApiMutation<{ disconnected: boolean }, void>(
    () => api.email.account.delete(),
    { successMessage: "Mailbox disconnected from OpenApply", invalidate: [queryKeys.email.all] },
  );
  const providerName = providerDisplayName(dock.provider);
  const status = account.data;
  const connector = status?.connected && status.provider === "connector";
  const legacy = status?.connected && status.provider !== "connector";
  const busy = dispatching || check !== null;
  const openAgent = (): void => {
    dock.expand();
    if (!desktop) setCompactAgentOpen(true);
  };

  useEffect(() => {
    if (!check) return;
    const timeout = setTimeout(() => {
      setCheck(null);
      setNotice({
        severity: "warning",
        text: "No new mailbox import was confirmed within two minutes. Check the agent panel for a sign-in prompt or missing Gmail tools, then retry. The agent may still be working.",
      });
    }, 120_000);
    return () => clearTimeout(timeout);
  }, [check]);

  useEffect(() => {
    if (!check) return;
    if (check.provider !== dock.provider) {
      setCheck(null);
      setNotice({
        severity: "info",
        text: "Agent changed. Check Gmail again with the selected agent.",
      });
    } else if (status && connectorUpdated(status, check.previousSync)) {
      setCheck(null);
      setNotice({
        severity: "success",
        text: "A new mailbox import was confirmed. Gmail is connected through your agent.",
      });
    }
  }, [check, status, dock.provider]);

  const checkConnection = async (): Promise<void> => {
    setNotice(null);
    setDispatching(true);
    openAgent();
    try {
      const runtime = await getStatus();
      if (runtime.session !== "running" || runtime.provider !== dock.provider) {
        throw new Error(
          `Start ${providerName} in the agent panel, finish sign-in, then check Gmail again.`,
        );
      }
      const fresh = await api.email.account.get({ fetch: { signal: AbortSignal.timeout(10_000) } });
      if (fresh.error || !fresh.data) throw new Error(apiErrorMessage(fresh.error));
      if (fresh.data.connected && fresh.data.provider !== "connector") {
        throw new Error("Disconnect the previous direct Google mailbox before linking your agent.");
      }
      const pending = {
        provider: dock.provider,
        previousSync: fresh.data.connected ? fresh.data.lastSyncAt : null,
      };
      await injectCommand(formatSkillCommand(dock.provider, "connect-email"), dock.provider);
      setCheck(pending);
      setNotice({
        severity: "info",
        text: "Request sent. Your agent will verify the mailbox and import recent job mail. Follow any authorization prompts in the agent panel; this page updates after a successful import.",
      });
    } catch (error) {
      setNotice({
        severity: "error",
        text:
          error instanceof Error
            ? error.message
            : "Could not reach your agent. Open the agent panel and try again.",
      });
    } finally {
      setDispatching(false);
    }
  };

  const handleDisconnect = async (): Promise<void> => {
    if (
      await confirm({
        title: "Disconnect mailbox from OpenApply?",
        description:
          "This removes the mailbox and its imported email records from OpenApply. Your Gmail messages and application history stay intact. It does not revoke the agent plugin's access; manage that in Claude or Codex.",
        confirmLabel: "Disconnect",
        destructive: true,
      })
    ) {
      setNotice(null);
      disconnect.mutate();
    }
  };

  return (
    <SectionCard
      title="Gmail through your agent"
      description="Use the Gmail connector in Claude Code or Codex to import job mail and retrieve verification codes."
    >
      <Stack spacing={2.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Chip label={providerName} size="small" variant="outlined" />
          <Typography variant="body2Muted" role="status">
            {connector ? "Connected via agent" : "Agent mailbox not connected"}
          </Typography>
          <Button size="small" onClick={openAgent}>
            Open agent / change provider
          </Button>
        </Stack>
        {account.isLoading && <LoadingSpinner />}
        {account.error && (
          <Alert
            severity="error"
            action={
              <Button color="inherit" onClick={() => void account.refetch()}>
                Retry
              </Button>
            }
          >
            Could not load mailbox status. {account.error.message}
          </Alert>
        )}
        {status?.connected && (
          <Stack spacing={0.5}>
            <Typography variant="body2Strong">{status.email}</Typography>
            <Typography variant="captionMuted">
              Last successful import:{" "}
              {status.lastSyncAt ? formatAbsoluteTime(status.lastSyncAt) : "none yet"}. Access is
              checked again when the agent runs.
            </Typography>
          </Stack>
        )}
        {legacy && (
          <Alert severity="info">
            This mailbox uses the previous direct Google connection. Disconnect it below before
            linking Gmail through your agent.
          </Alert>
        )}
        {connector && status.needsReauth && (
          <Alert severity="warning">
            Gmail needs attention. Reconnect it in your agent, then check again.
          </Alert>
        )}
        <Stack spacing={1.5}>
          {dock.provider === "claude" && (
            <>
              <Typography variant="body2">
                1. Connect Gmail in your Claude account, then sign in to Claude Code with that same
                subscription account.
              </Typography>
              <Button
                component="a"
                href="https://claude.ai/customize/connectors"
                target="_blank"
                rel="noopener noreferrer"
                variant="outlined"
                sx={{ alignSelf: "flex-start" }}
              >
                Open Claude connectors
              </Button>
              <Typography variant="body2">
                2. In OpenApply’s agent panel, open <code>/mcp</code> and confirm Gmail is
                available. Restart the agent if you just connected it. An API-key login does not
                load Claude account connectors.
              </Typography>
            </>
          )}
          {dock.provider === "codex" && (
            <>
              <Typography variant="body2">
                1. In OpenApply’s Codex agent panel, open <code>/plugins</code>, install or enable
                Gmail, and complete its account authorization.
              </Typography>
              <Typography variant="body2">
                2. Start a fresh agent session and check <code>/apps</code> or <code>/mcp</code> for
                Gmail. A connection in another chat does not confirm access in this session.
              </Typography>
            </>
          )}
          <Typography variant="body2">
            3. Check the connection below. The agent confirms your mailbox matches your profile and
            imports recent job mail. It does not send emails or change application statuses during
            this check.
          </Typography>
        </Stack>
        {notice && <Alert severity={notice.severity}>{notice.text}</Alert>}
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
          <Button
            variant="contained"
            disabled={busy || !status || Boolean(legacy) || disconnect.isPending}
            loading={busy}
            onClick={() => void checkConnection()}
          >
            {busy ? "Checking Gmail…" : `Check Gmail with ${providerName}`}
          </Button>
          {check && (
            <Button
              onClick={() => {
                setCheck(null);
                setNotice({
                  severity: "info",
                  text: "Stopped waiting here. The agent may still finish its request; check its panel before retrying.",
                });
              }}
            >
              Stop waiting
            </Button>
          )}
          {status?.connected && (
            <Button
              variant="outlined"
              color="error"
              disabled={busy || disconnect.isPending}
              onClick={() => void handleDisconnect()}
            >
              Disconnect from OpenApply
            </Button>
          )}
          <LinkButton href="/docs/email-setup">Setup guide</LinkButton>
        </Stack>
        <Typography variant="captionMuted">
          Authenticate with the provider’s own sign-in flow. OpenApply does not need your Gmail
          password or Google Cloud client keys. Sync runs while your local agent is available.
        </Typography>
        <Drawer
          anchor="right"
          open={compactAgentOpen && dock.expanded && !desktop}
          onClose={() => setCompactAgentOpen(false)}
          slotProps={{ paper: { sx: { width: { xs: "100%", sm: 480 }, maxWidth: "100%" } } }}
        >
          <DockPanel />
        </Drawer>
      </Stack>
    </SectionCard>
  );
}
