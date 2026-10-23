import type { ReactElement } from "react";
import { Alert, Chip, Stack, Typography } from "@mui/material";
import type { AccountSetupDetail } from "@openapply/contracts/account-setup";
import { accountSetupPresentation } from "./account-setup-state";

interface AccountSetupSummaryProps {
  detail: AccountSetupDetail;
}

export function AccountSetupSummary({ detail }: AccountSetupSummaryProps): ReactElement {
  const { snapshot, attempt } = detail.context;
  const state = accountSetupPresentation(detail);
  return (
    <Stack
      spacing={1.5}
      data-account-setup-id={detail.item.id}
      data-account-setup-revision={snapshot.revision}
    >
      <Chip sx={{ alignSelf: "flex-start" }} label={state.label} />
      <Typography variant="h6" sx={{ overflowWrap: "anywhere" }}>
        {snapshot.tenantOrigin}
      </Typography>
      <Typography>{snapshot.email}</Typography>
      <Typography variant="body2" color="text.secondary">
        Account setup only. This work cannot upload documents or submit an application.
      </Typography>
      {state.signupConsumed && (
        <Typography variant="body2">
          The account creation attempt is already used. Further checks must inspect this account
          without repeating signup.
        </Typography>
      )}
      {attempt.phase === "authenticated" && (
        <Alert severity="success">
          The worker observed an authenticated employer session. Account setup is complete.
        </Alert>
      )}
      {attempt.phase === "unknown" && (
        <Alert severity="warning">
          The account outcome is uncertain. Inspect the existing session or skip; account creation
          will not be repeated.
        </Alert>
      )}
      {attempt.phase === "verification_pending" && (
        <Alert severity="info">
          A verification step remains. Complete it in the retained account browser, or confirm the
          connected mailbox for a bounded verification check.
        </Alert>
      )}
      {attempt.mailbox && (
        <Typography variant="body2" color="text.secondary">
          Verification mailbox: {attempt.mailbox.email}.{" "}
          {attempt.mailbox.basis === "user_confirmed"
            ? "Confirmed by you; provider identity has not been verified by this confirmation."
            : "Identity verified by the provider."}
        </Typography>
      )}
      {attempt.mailboxBlocked && (
        <Alert severity="warning">
          The worker reported a mailbox mismatch or authorization problem. Reconnect the correct
          mailbox before confirming it again.
        </Alert>
      )}
      {detail.item.reason && <Typography variant="body2">{detail.item.reason}</Typography>}
    </Stack>
  );
}
