"use client";

import type { ReactElement } from "react";
import type { ConfirmEmailChangeInput } from "@openapply/contracts/auth";
import { api } from "@/api/client";
import { useApiMutation } from "@/api/hooks";
import type { ConfirmEmailChangeResponse } from "@/api/types";
import { MagicLinkView } from "./magic-link-view";

interface ConfirmEmailChangeViewProps {
  token?: string;
}

/** Lands from the email-change magic link; confirming revokes all sessions. */
export function ConfirmEmailChangeView(props: ConfirmEmailChangeViewProps): ReactElement {
  const { token } = props;
  const confirmChange = useApiMutation<ConfirmEmailChangeResponse, ConfirmEmailChangeInput>(
    (body) => api.auth.email.change.confirm.post(body),
  );

  return (
    <MagicLinkView
      token={token}
      mutation={confirmChange}
      pendingText="Confirming your new email…"
      successText="Your email has been updated. Sign in with your new address."
      successLabel="Go to sign in"
      successHref="/login"
      errorHint="This link may have expired or already been used. You can request a new one from the Account security page."
    />
  );
}
