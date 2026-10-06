"use client";

import type { ReactElement } from "react";
import { Alert, Button, Stack, Typography } from "@mui/material";
import type { VerifyEmailInput } from "@openapply/contracts/auth";
import { api } from "@/api/client";
import { useApiMutation } from "@/api/hooks";
import type { ResendVerificationResponse, VerifyEmailResponse } from "@/api/types";
import { useAuthActions, useSession } from "@/hooks/use-auth";
import { MagicLinkView } from "./magic-link-view";

interface VerifyEmailViewProps {
  /** Present when the user arrived from a verification magic link. */
  token?: string;
}

/**
 * Two modes share the `/verify-email` route:
 * - With a `token` (magic link), auto-confirm the address and offer to continue.
 * - Without one, act as the gate for a signed-in but unverified user: tell them
 *   to check their inbox, and let them resend or sign out.
 */
export function VerifyEmailView(props: VerifyEmailViewProps): ReactElement {
  const { token } = props;
  return token ? <VerifyTokenView token={token} /> : <VerifyGateView />;
}

function VerifyTokenView(props: { token: string }): ReactElement {
  const { token } = props;
  const verifyEmail = useApiMutation<VerifyEmailResponse, VerifyEmailInput>((body) =>
    api.auth.email.verify.post(body),
  );

  return (
    <MagicLinkView
      token={token}
      mutation={verifyEmail}
      pendingText="Verifying your email…"
      successText="Your email is verified."
      successLabel="Continue"
      successHref="/workspace"
      errorHint="This link may have expired or already been used."
    />
  );
}

function VerifyGateView(): ReactElement {
  const { user } = useSession();
  const { logout } = useAuthActions();
  const resendVerification = useApiMutation<ResendVerificationResponse, void>(() =>
    api.auth.email.resend.post(),
  );

  return (
    <Stack spacing={2.5}>
      <Typography variant="body2">
        We&apos;ve sent a verification link to{" "}
        {user?.email ? <strong>{user.email}</strong> : "your email"}. Click it to activate your
        account, then come back here.
      </Typography>

      {resendVerification.isSuccess && (
        <Alert severity="success">Verification email sent - check your inbox.</Alert>
      )}
      {resendVerification.error && (
        <Alert severity="error">{resendVerification.error.message}</Alert>
      )}

      <Button
        variant="contained"
        size="large"
        fullWidth
        onClick={() => resendVerification.mutate()}
        disabled={resendVerification.isPending}
      >
        {resendVerification.isPending ? "Sending…" : "Resend email"}
      </Button>

      <Button variant="text" fullWidth onClick={() => logout.mutate()} disabled={logout.isPending}>
        Sign out
      </Button>
    </Stack>
  );
}
