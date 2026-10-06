"use client";

import { type ReactElement, useState } from "react";
import { Add, DeleteOutlined } from "@mui/icons-material";
import { Alert, Box, Button, Chip, Drawer, Stack, Typography } from "@mui/material";
import dynamic from "next/dynamic";
import { api } from "@/api/client";
import { useApiMutation, useApiQuery } from "@/api/hooks";
import { emailQueries, userQueries } from "@/api/queries";
import { queryKeys } from "@/api/query-keys";
import type { EmailAccountDto } from "@/api/types/email";
import { LinkButton, TooltipIconButton } from "@/components/ui/buttons";
import { LoadingSpinner } from "@/components/ui/feedback";
import { SectionCard } from "@/components/ui/layout/section-card";
import { providerDisplayName } from "@/lib/terminal";
import { useAgentAvailable, useAgentDock } from "@/providers/agent-provider";
import { useConfirm } from "@/providers/confirm-provider";
import { formatAbsoluteTime } from "@/utils/format";
import { AddEmailDialog } from "./add-email-dialog";
import { useGmailCheck } from "./use-gmail-check";

const DockPanel = dynamic(
  () => import("@/components/features/agent-dock/dock-panel").then((module) => module.DockPanel),
  { ssr: false },
);

export function ConnectCard(): ReactElement {
  const dock = useAgentDock();
  const confirm = useConfirm();
  const desktop = useAgentAvailable();
  const check = useGmailCheck(dock.provider);
  const [compactAgentOpen, setCompactAgentOpen] = useState(false);
  const [dialog, setDialog] = useState<"add" | "change" | null>(null);
  const accounts = useApiQuery(emailQueries.accounts(), {
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const profile = useApiQuery(userQueries.detail());
  const select = useApiMutation((id: string) => api.email.accounts({ id }).select.post(), {
    successMessage: "Selected mailbox changed",
    invalidate: [queryKeys.email.all],
  });
  const remove = useApiMutation((id: string) => api.email.accounts({ id }).delete(), {
    successMessage: "Mailbox removed from OpenApply",
    invalidate: [queryKeys.email.all],
  });
  const rows = accounts.data ?? [];
  const selected = rows.find((account) => account.selected);
  const providerName = providerDisplayName(dock.provider);
  const busy = check.busy || Boolean(check.confirmation) || select.isPending || remove.isPending;
  const intendedEmail = selected?.email || profile.data?.user.contactEmail;
  const openAgent = (): void => {
    dock.expand();
    if (!desktop) setCompactAgentOpen(true);
  };
  const runCheck = (email: string, change = false): void => {
    dock.collapse();
    setCompactAgentOpen(false);
    void check.run(email, change);
  };
  const chooseMailbox = (id: string): void => {
    setDialog(null);
    select.mutate(id);
  };
  const removeMailbox = async (account: EmailAccountDto): Promise<void> => {
    if (
      await confirm({
        title: `Remove ${account.email}?`,
        description:
          "This removes only this mailbox and its imported messages from OpenApply. Other saved mailboxes, Gmail messages and application history stay intact. Gmail authorization remains in your provider.",
        confirmLabel: "Remove email",
        destructive: true,
      })
    )
      remove.mutate(account.id);
  };

  return (
    <SectionCard
      title="Connected email"
      description="Check Gmail through your local agent, then choose the mailbox OpenApply uses."
    >
      <Stack spacing={2.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Chip label={providerName} size="small" variant="outlined" />
          <Typography variant="body2Muted">Routine checks run in the background.</Typography>
        </Stack>
        {accounts.isLoading && <LoadingSpinner />}
        {accounts.error && (
          <Alert
            severity="error"
            action={
              <Button color="inherit" onClick={() => void accounts.refetch()}>
                Retry
              </Button>
            }
          >
            Could not load saved emails. {accounts.error.message}
          </Alert>
        )}
        {!accounts.isLoading && !accounts.error && rows.length === 0 && (
          <Box>
            <Typography variant="body2Strong">No email connected yet</Typography>
            <Typography variant="body2Muted">
              {intendedEmail
                ? `Check ${intendedEmail}, or add a different email.`
                : "Add your Gmail address to verify and save it."}
            </Typography>
          </Box>
        )}
        {rows.length > 0 && (
          <Stack component="ul" spacing={1.5} sx={{ listStyle: "none", m: 0, p: 0 }}>
            {rows.map((account) => (
              <Stack
                key={account.id}
                component="li"
                direction={{ xs: "column", sm: "row" }}
                spacing={1.5}
                sx={{
                  justifyContent: "space-between",
                  alignItems: { xs: "flex-start", sm: "center" },
                  borderBottom: 1,
                  borderColor: "line.divider",
                  pb: 1.5,
                }}
              >
                <Stack spacing={0.5} sx={{ minWidth: 0 }}>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: "center", flexWrap: "wrap", overflowWrap: "anywhere" }}
                  >
                    <Typography variant="body2Strong">{account.email}</Typography>
                    {account.selected && <Chip label="Selected" size="small" variant="outlined" />}
                  </Stack>
                  <Typography variant="captionMuted">
                    {account.lastCheckedAt
                      ? `Last checked ${formatAbsoluteTime(account.lastCheckedAt)}`
                      : "Not checked in the background yet"}
                    {account.runtimeProvider &&
                      ` · ${providerDisplayName(account.runtimeProvider)}`}
                  </Typography>
                  <Typography variant="captionMuted">
                    {account.identityVerified
                      ? "Mailbox address verified by the provider"
                      : "Mailbox address provided by you; not verified by the provider"}
                  </Typography>
                  {account.needsReauth && (
                    <Typography variant="captionMuted">
                      Reconnect Gmail in your provider, then check again.
                    </Typography>
                  )}
                </Stack>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexShrink: 0 }}>
                  {!account.selected && (
                    <Button size="small" disabled={busy} onClick={() => chooseMailbox(account.id)}>
                      Use this email
                    </Button>
                  )}
                  <TooltipIconButton
                    title={`Remove ${account.email}`}
                    disabled={busy}
                    onClick={() => void removeMailbox(account)}
                  >
                    <DeleteOutlined fontSize="small" />
                  </TooltipIconButton>
                </Stack>
              </Stack>
            ))}
          </Stack>
        )}
        {check.notice && (
          <Alert severity={check.notice.severity} role="status">
            {check.notice.text}
          </Alert>
        )}
        {check.confirmation && (
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
            <Button variant="contained" onClick={() => void check.confirm()}>
              Confirm email and save
            </Button>
            <Button onClick={check.dismissConfirmation}>Cancel</Button>
          </Stack>
        )}
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
          <Button
            variant="contained"
            disabled={busy || accounts.isLoading || Boolean(accounts.error)}
            loading={check.busy}
            onClick={() => (intendedEmail ? runCheck(intendedEmail) : setDialog("add"))}
          >
            {check.busy ? "Checking Gmail…" : "Check Gmail"}
          </Button>
          {check.phase === "checking" && <Button onClick={check.cancel}>Cancel check</Button>}
          <Button
            variant="outlined"
            startIcon={<Add />}
            disabled={busy}
            onClick={() => setDialog("add")}
          >
            Add email
          </Button>
          {rows.length > 0 && (
            <Button disabled={busy} onClick={() => setDialog("change")}>
              Change email
            </Button>
          )}
        </Stack>
        <Typography variant="captionMuted">
          Selecting a saved email keeps its imported mail. It does not change your applicant profile
          or switch the Gmail account authorized in {providerName}.
        </Typography>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
          {dock.provider === "claude" && (
            <Button
              component="a"
              href="https://claude.ai/customize/connectors"
              target="_blank"
              rel="noopener noreferrer"
              size="small"
            >
              Manage Gmail in Claude
            </Button>
          )}
          <Button size="small" disabled={check.busy} onClick={openAgent}>
            Agent sign-in / setup
          </Button>
          <LinkButton href="/docs/email-setup" size="small">
            Setup guide
          </LinkButton>
        </Stack>
        {dialog && (
          <AddEmailDialog
            initialEmail={
              dialog === "add" && rows.length === 0 ? (profile.data?.user.contactEmail ?? "") : ""
            }
            providerName={providerName}
            changing={dialog === "change"}
            accounts={rows}
            onClose={() => setDialog(null)}
            onSelect={chooseMailbox}
            onCheck={(email) => runCheck(email, dialog === "change")}
          />
        )}
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
