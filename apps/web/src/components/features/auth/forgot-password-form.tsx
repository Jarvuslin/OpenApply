"use client";

import type { ReactElement } from "react";
import { type ForgotPasswordInput, ForgotPasswordSchema } from "@jobpilot/contracts/auth";
import { Alert, Link, Stack, Typography } from "@mui/material";
import { api } from "@/api/client";
import { useApiMutation } from "@/api/hooks";
import type { ForgotPasswordResponse } from "@/api/types";
import { useAppForm } from "@/components/ui/form/tanstack";
import { useAuthOptions } from "@/hooks/use-auth-options";

const DEFAULT_VALUES: ForgotPasswordInput = { email: "" };

export function ForgotPasswordForm(): ReactElement {
  const options = useAuthOptions();
  const forgotPassword = useApiMutation<ForgotPasswordResponse, ForgotPasswordInput>((body) =>
    api.auth.password.forgot.post(body),
  );

  const form = useAppForm({
    defaultValues: DEFAULT_VALUES,
    validators: { onSubmit: ForgotPasswordSchema },
    onSubmit: ({ value }) => forgotPassword.mutateAsync(value),
  });

  if (forgotPassword.isSuccess) {
    return (
      <Stack spacing={2.5}>
        <Alert severity="success">
          {options.data?.emailDelivery === "console"
            ? "If an account exists, its reset link was written to the local API log. This server has no email delivery configured."
            : options.data?.emailDelivery === "email"
              ? "If an account exists for that address, we've sent a password reset link. Check your inbox."
              : "Your request was accepted. A reset link is available through this server's configured email delivery method if the account exists."}
        </Alert>
        <Typography variant="body2Muted" sx={{ textAlign: "center" }}>
          <Link href="/login" color="primary">
            Back to sign in
          </Link>
        </Typography>
      </Stack>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      <Stack spacing={2.5}>
        {forgotPassword.error && <Alert severity="error">{forgotPassword.error.message}</Alert>}

        <form.AppField name="email">
          {(field) => (
            <field.TextField
              label="Email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="you@example.com"
            />
          )}
        </form.AppField>

        <form.AppForm>
          <form.SubmitButton disabled={forgotPassword.isPending} fullWidth size="large">
            {forgotPassword.isPending ? "Sending…" : "Send reset link"}
          </form.SubmitButton>
        </form.AppForm>

        <Typography variant="body2Muted" sx={{ textAlign: "center" }}>
          Remembered it?{" "}
          <Link href="/login" color="primary">
            Sign in
          </Link>
        </Typography>
      </Stack>
    </form>
  );
}
