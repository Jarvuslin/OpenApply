"use client";

import type { ReactElement } from "react";
import type { OAuthProviderInput } from "@jobpilot/contracts/auth";
import { Alert, Box, Button, Stack, Tooltip, Typography } from "@mui/material";
import { api } from "@/api/client";
import { useApiMutation } from "@/api/hooks";
import { queryKeys } from "@/api/query-keys";
import type { UnlinkOAuthResponse } from "@/api/types";
import { OAUTH_PROVIDERS, oauthStartUrl, resolveOauthReason } from "@/components/features/auth";
import { SectionCard } from "@/components/ui/layout/section-card";
import { useSession } from "@/hooks/use-auth";
import { useAuthOptions } from "@/hooks/use-auth-options";
import { useConfirm } from "@/providers/confirm-provider";

interface ConnectedAccountsCardProps {
  /** `oauth` query flag from the OAuth callback redirect: "linked" or "error". */
  oauthResult?: string;
  provider?: string;
  reason?: string;
}

export function ConnectedAccountsCard(props: ConnectedAccountsCardProps): ReactElement {
  const { oauthResult, provider, reason } = props;
  const { user } = useSession();
  const options = useAuthOptions();
  const confirm = useConfirm();

  const linked = user?.providers ?? [];
  const hasPassword = user?.hasPassword ?? true;
  const lastMethod = !hasPassword && linked.length === 1;

  const unlink = useApiMutation<UnlinkOAuthResponse, OAuthProviderInput>(
    (p) => api.auth.providers({ provider: p }).delete(),
    { successMessage: "Account unlinked", invalidate: [queryKeys.auth.me()] },
  );

  const link = (p: OAuthProviderInput): void => {
    window.location.href = oauthStartUrl(p, "link");
  };

  const handleUnlink = async (p: OAuthProviderInput, label: string): Promise<void> => {
    const confirmed = await confirm({
      title: `Unlink ${label}?`,
      description: `You'll no longer be able to sign in with ${label}.`,
      confirmLabel: "Unlink",
      destructive: true,
    });
    if (confirmed) {
      unlink.mutate(p);
    }
  };

  return (
    <SectionCard
      title="Connected accounts"
      description="Sign in with these providers alongside your email and password."
    >
      <Stack spacing={2}>
        {oauthResult === "linked" && (
          <Alert severity="success">
            {OAUTH_PROVIDERS.find((p) => p.id === provider)?.label ?? "Account"} linked.
          </Alert>
        )}
        {oauthResult === "error" && reason && (
          <Alert severity="error">{resolveOauthReason(reason)}</Alert>
        )}

        {OAUTH_PROVIDERS.map(({ id, label }) => {
          const isLinked = linked.includes(id);
          return (
            <Stack
              key={id}
              direction="row"
              spacing={2}
              sx={{ alignItems: "center", justifyContent: "space-between" }}
            >
              <Box>
                <Typography variant="body2Strong">{label}</Typography>
                <Typography variant="captionMuted">
                  {isLinked
                    ? "Connected"
                    : options.data?.providers[id]
                      ? "Not connected"
                      : "Not set up on this server"}
                </Typography>
              </Box>
              {isLinked ? (
                <Tooltip
                  title={
                    lastMethod ? "This is your only sign-in method - set a password first" : ""
                  }
                >
                  <span>
                    <Button
                      variant="outlined"
                      color="error"
                      disabled={lastMethod || unlink.isPending}
                      onClick={() => void handleUnlink(id, label)}
                    >
                      Unlink
                    </Button>
                  </span>
                </Tooltip>
              ) : (
                <Button
                  variant="outlined"
                  disabled={!options.data?.providers[id]}
                  onClick={() => link(id)}
                >
                  Link
                </Button>
              )}
            </Stack>
          );
        })}
      </Stack>
    </SectionCard>
  );
}
