"use client";

import type { ReactElement } from "react";
import { Alert, Link, Stack, Typography } from "@mui/material";
import { type RegisterInput, RegisterSchema } from "@openapply/contracts/auth";
import { useAppForm } from "@/components/ui/form/tanstack";
import { useAuthActions } from "@/hooks/use-auth";
import { useAuthOptions } from "@/hooks/use-auth-options";
import { OAuthButtons } from "./oauth-buttons";

const DEFAULT_VALUES: RegisterInput = { email: "", password: "" };

export function RegisterForm(): ReactElement {
  const { register } = useAuthActions();
  const options = useAuthOptions();

  const form = useAppForm({
    defaultValues: DEFAULT_VALUES,
    validators: { onSubmit: RegisterSchema },
    onSubmit: async ({ value }) => {
      await register.mutateAsync(value);
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      <Stack spacing={2.5}>
        {register.error && <Alert severity="error">{register.error.message}</Alert>}
        {options.data && !options.data.emailVerificationRequired && (
          <Alert severity="info">
            Local development: email verification is skipped for new accounts.
          </Alert>
        )}
        {options.data?.emailVerificationRequired && options.data.emailDelivery === "console" && (
          <Alert severity="info">
            Local email delivery: verification links appear in the API log.
          </Alert>
        )}

        <form.AppField name="email">
          {(field) => (
            <field.TextField
              labelPosition="above"
              size="medium"
              label="Email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="you@example.com"
            />
          )}
        </form.AppField>

        <form.AppField name="password">
          {(field) => (
            <field.TextField
              labelPosition="above"
              size="medium"
              label="Password"
              type="password"
              autoComplete="new-password"
              helperText="8+ characters with an uppercase letter, a lowercase letter, a number, and a special character."
            />
          )}
        </form.AppField>

        <form.AppForm>
          <form.SubmitButton disabled={register.isPending} fullWidth size="large">
            {register.isPending ? "Creating account…" : "Create account"}
          </form.SubmitButton>
        </form.AppForm>

        <OAuthButtons />

        <Typography variant="body2Muted" sx={{ textAlign: "center" }}>
          Already have an account?{" "}
          <Link href="/login" color="primary">
            Sign in
          </Link>
        </Typography>
      </Stack>
    </form>
  );
}
