"use client";

import { type ReactElement, useRef, useState } from "react";
import { Alert, Button, Checkbox, FormControlLabel, Stack, Typography } from "@mui/material";
import type { AccountSetupDetail } from "@openapply/contracts/account-setup";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useQueueCompanion } from "@/hooks/use-queue-companion";
import {
  ACCOUNT_SETUP_BUDGET,
  getAccountSetupReadiness,
  launchAccountSetup,
} from "@/lib/account-setup-companion";
import { accountSetupPresentation } from "./account-setup-state";

interface AccountSetupLaunchProps {
  detail: AccountSetupDetail;
  onUpdated: () => Promise<void>;
}

export function AccountSetupLaunch({ detail, onUpdated }: AccountSetupLaunchProps): ReactElement {
  const companion = useQueueCompanion();
  const readiness = useQuery({
    queryKey: ["account-setup-readiness", companion.accountId],
    queryFn: getAccountSetupReadiness,
    retry: false,
  });
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const dispatched = useRef(false);
  const state = accountSetupPresentation(detail);
  const ready =
    !readiness.isError &&
    readiness.data?.ready === true &&
    companion.status?.connected &&
    companion.status.connectionId &&
    companion.accountId;

  async function launch(): Promise<void> {
    if (
      !ready ||
      !approved ||
      busy ||
      dispatched.current ||
      !companion.status?.connectionId ||
      !companion.accountId
    )
      return;
    dispatched.current = true;
    setBusy(true);
    setMessage("");
    try {
      const snapshot = await api["account-setup"]({ id: detail.item.id }).snapshot.get();
      if (
        snapshot.error ||
        !snapshot.data ||
        snapshot.data.snapshotHash !== detail.context.snapshot.snapshotHash
      )
        throw new Error("changed");
      const token = await api.auth.tokens.terminal.post();
      if (token.error || !token.data) throw new Error("unauthorized");
      await launchAccountSetup({
        apiToken: token.data.token,
        expectedOwnerId: companion.accountId,
        connectionId: companion.status.connectionId,
        snapshot: snapshot.data,
        approvalReference: `web-account-${crypto.randomUUID()}`,
      });
      setMessage("The bounded run was authorized. Queue will report its observed progress.");
      setFailed(false);
    } catch {
      setFailed(true);
      setMessage(
        "The run was not acknowledged or its scope changed. Reload the account and inspect Queue before authorizing another run.",
      );
    } finally {
      setBusy(false);
      setApproved(false);
      await onUpdated();
      await companion.query.refetch();
    }
  }

  return (
    <Stack spacing={2}>
      <Typography variant="subtitle1">{state.operationLabel}</Typography>
      <Typography variant="body2">
        Approve one Claude run for this exact employer and account revision. At most{" "}
        {ACCOUNT_SETUP_BUDGET.maxRequests} requests,{" "}
        {ACCOUNT_SETUP_BUDGET.maxTokens.toLocaleString()} tokens, {ACCOUNT_SETUP_BUDGET.maxTurns}{" "}
        turns, ${ACCOUNT_SETUP_BUDGET.maxBudgetUsd} reported usage, and{" "}
        {ACCOUNT_SETUP_BUDGET.maxSeconds} seconds. No subagents.
      </Typography>
      <Typography variant="caption" color="text.secondary">
        Usage is measured after provider responses. A final response can exceed a limit before the
        run stops.
      </Typography>
      {!companion.status?.connected && (
        <Alert severity="info">Connect this computer from the sidebar before starting.</Alert>
      )}
      {readiness.isPending && (
        <Typography>Checking account automation on this computer…</Typography>
      )}
      {readiness.isError && (
        <Alert severity="warning">Account automation readiness is unavailable.</Alert>
      )}
      {!readiness.isError && readiness.data && !readiness.data.ready && (
        <Alert severity="info">
          Account automation is not ready on this computer.{" "}
          {readiness.data.blockers.map((blocker) => blocker.message).join(" ")}
        </Alert>
      )}
      <FormControlLabel
        control={
          <Checkbox
            checked={approved}
            disabled={busy || !ready || dispatched.current}
            onChange={(event) => setApproved(event.target.checked)}
          />
        }
        label="Authorize this one account-only run with the displayed limits"
      />
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
        <Button
          variant="contained"
          disabled={!ready || !approved || busy || dispatched.current}
          onClick={() => void launch()}
        >
          Start bounded account run
        </Button>
        <Button disabled={busy} onClick={() => void readiness.refetch()}>
          Check readiness
        </Button>
      </Stack>
      {message && <Alert severity={failed ? "warning" : "success"}>{message}</Alert>}
    </Stack>
  );
}
