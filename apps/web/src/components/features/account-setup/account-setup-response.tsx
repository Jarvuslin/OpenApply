"use client";

import { type ReactElement, useRef, useState } from "react";
import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import {
  type AccountSetupDetail,
  accountSetupSaveCredentialsSchema,
} from "@openapply/contracts/account-setup";
import { z } from "zod/v4";
import { api } from "@/api/client";
import { useAppForm } from "@/components/ui/form/tanstack";
import { AccountSetupHandoff } from "./account-setup-handoff";
import { accountSetupPresentation } from "./account-setup-state";

interface AccountSetupResponseProps {
  detail: AccountSetupDetail;
  onUpdated: () => Promise<void>;
}

export function AccountSetupResponse({
  detail,
  onUpdated,
}: AccountSetupResponseProps): ReactElement {
  const state = accountSetupPresentation(detail);
  const { snapshot } = detail.context;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const acting = useRef(false);
  const form = useAppForm({
    defaultValues: { password: "", mailboxConfirmed: false },
    validators: {
      onSubmit: z.object({
        password: accountSetupSaveCredentialsSchema.shape.password,
        mailboxConfirmed: z.boolean(),
      }),
    },
    onSubmit: async () => {
      await act("credentials");
    },
  });

  async function act(action: "credentials" | "continue" | "skip"): Promise<void> {
    if (acting.current || locked) return;
    acting.current = true;
    setBusy(true);
    setError("");
    try {
      const route = api["account-setup"]({ id: detail.item.id });
      const result =
        action === "credentials"
          ? await route.credentials.post({
              expectedRevision: snapshot.revision,
              password: form.state.values.password,
            })
          : await route.continue.post({
              expectedRevision: snapshot.revision,
              action,
              ...(state.mailbox && form.state.values.mailboxConfirmed
                ? {
                    mailboxConfirmation: {
                      email: snapshot.email,
                      basis: "user_confirmed" as const,
                    },
                  }
                : {}),
            });
      if (result.error) throw new Error("unacknowledged");
      setLocked(true);
    } catch {
      setLocked(true);
      setError(
        "The response was not acknowledged or the request changed. Reload the current account state before trying again.",
      );
    } finally {
      form.reset();
      setBusy(false);
      acting.current = false;
      await onUpdated();
    }
  }

  return (
    <Stack spacing={2}>
      {state.password && (
        <Box
          component="form"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <Stack spacing={2}>
            <Typography>
              This employer account already exists. Enter its current password here or skip account
              setup.
            </Typography>
            <form.AppField name="password">
              {(field) => (
                <field.TextField
                  label="Current employer account password"
                  type="password"
                  autoComplete="current-password"
                  disabled={busy || locked}
                  helperText="Saved encrypted for this exact employer. Never included in a question answer."
                />
              )}
            </form.AppField>
            <form.AppForm>
              <form.SubmitButton disabled={busy || locked}>
                Save password for account inspection
              </form.SubmitButton>
            </form.AppForm>
          </Stack>
        </Box>
      )}
      {state.manual && <AccountSetupHandoff id={detail.item.id} />}
      {state.mailbox && (
        <Stack spacing={1}>
          <form.AppField name="mailboxConfirmed">
            {(field) => (
              <field.Checkbox
                disabled={busy || locked}
                label={`I confirm ${snapshot.email} is the Gmail account currently connected to this worker`}
              />
            )}
          </form.AppField>
          <Typography variant="caption" color="text.secondary">
            This is your confirmation, not provider verification. Only verification messages
            matching this employer, recipient, and request time may be used.
          </Typography>
        </Stack>
      )}
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
        {state.continue && (
          <Button
            variant="contained"
            disabled={busy || locked}
            onClick={() => void act("continue")}
          >
            Save response and prepare account inspection
          </Button>
        )}
        {state.skip && (
          <Button disabled={busy || locked} onClick={() => void act("skip")}>
            Skip account setup
          </Button>
        )}
      </Stack>
      {(state.password || state.continue) && (
        <Typography variant="body2" color="text.secondary">
          Saving prepares a fresh inspection. A separate bounded run must be authorized before the
          worker continues.
        </Typography>
      )}
      {error && <Alert severity="warning">{error}</Alert>}
    </Stack>
  );
}
