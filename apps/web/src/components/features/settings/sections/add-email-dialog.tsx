"use client";

import type { ReactElement } from "react";
import { Button, Stack, Typography } from "@mui/material";
import { z } from "zod/v4";
import type { EmailAccountDto } from "@/api/types/email";
import { FormDialogShell } from "@/components/ui/form/form-dialog";
import { useAppForm } from "@/components/ui/form/tanstack";

const mailboxSchema = z.object({ email: z.string().trim().pipe(z.email()) });

interface AddEmailDialogProps {
  initialEmail: string;
  providerName: string;
  onClose: () => void;
  onCheck: (email: string) => void;
  changing?: boolean;
  accounts?: EmailAccountDto[];
  onSelect?: (id: string) => void;
}

export function AddEmailDialog(props: AddEmailDialogProps): ReactElement {
  const { initialEmail, providerName, onClose, onCheck, changing, accounts, onSelect } = props;
  const form = useAppForm({
    defaultValues: { email: initialEmail },
    validators: { onSubmit: mailboxSchema },
    onSubmit: async ({ value }) => {
      onCheck(value.email.trim().toLowerCase());
      onClose();
    },
  });

  return (
    <FormDialogShell
      open
      title={changing ? "Change connected email" : "Add an email"}
      onClose={onClose}
      onSubmit={() => void form.handleSubmit()}
      submit={
        <Button type="submit" variant="contained">
          Check and add
        </Button>
      }
    >
      {changing && (
        <Stack spacing={1}>
          <Typography variant="body2Muted">
            Choose a saved mailbox, or verify another one below. Switching keeps your imported mail.
          </Typography>
          {accounts
            ?.filter((account) => !account.selected)
            .map((account) => (
              <Button key={account.id} variant="outlined" onClick={() => onSelect?.(account.id)}>
                Use {account.email}
              </Button>
            ))}
        </Stack>
      )}
      <Typography variant="body2Muted">
        Connect this Gmail account in {providerName} first. OpenApply will check the account in the
        background. If the connector cannot report its mailbox address, you will be asked to confirm
        the address before saving it.
      </Typography>
      <form.AppField name="email">
        {(field) => (
          <field.TextField
            label="Gmail address"
            labelPosition="above"
            type="email"
            autoComplete="email"
            placeholder="you@gmail.com"
            autoFocus
          />
        )}
      </form.AppField>
      <Typography variant="captionMuted">
        This does not change your applicant profile or the email on your résumé.
      </Typography>
    </FormDialogShell>
  );
}
