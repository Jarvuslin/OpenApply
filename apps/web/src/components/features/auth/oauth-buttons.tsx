"use client";

import type { ReactElement } from "react";
import { GitHub, Google } from "@mui/icons-material";
import { Alert, Button, Divider, Stack, Typography } from "@mui/material";
import type { OAuthProviderInput } from "@openapply/contracts/auth";
import { useAuthOptions } from "@/hooks/use-auth-options";
import { OAUTH_PROVIDERS, oauthStartUrl } from "./oauth";

const ICONS: Record<OAuthProviderInput, ReactElement> = {
  google: <Google />,
  github: <GitHub />,
};

/** Google/GitHub sign-in buttons; the API drives the whole redirect flow. */
export function OAuthButtons(): ReactElement {
  const options = useAuthOptions();
  const unavailable = options.data
    ? OAUTH_PROVIDERS.filter(({ id }) => !options.data?.providers[id]).map(({ label }) => label)
    : [];
  return (
    <Stack spacing={2}>
      <Divider>
        <Typography variant="captionMuted">or continue with</Typography>
      </Divider>
      <Stack direction="row" spacing={1.5}>
        {OAUTH_PROVIDERS.map(({ id, label }) => (
          <Button
            key={id}
            variant="outlined"
            size="large"
            type="button"
            fullWidth
            startIcon={ICONS[id]}
            disabled={!options.data?.providers[id]}
            onClick={() => {
              window.location.href = oauthStartUrl(id);
            }}
          >
            {label}
          </Button>
        ))}
      </Stack>
      {options.isLoading && (
        <Typography variant="captionMuted">Checking sign-in options…</Typography>
      )}
      {options.error && (
        <Alert
          severity="warning"
          action={
            <Button color="inherit" onClick={() => void options.refetch()}>
              Retry
            </Button>
          }
        >
          Could not check sign-in options. Check that the OpenApply backend is running.
        </Alert>
      )}
      {unavailable.length > 0 && (
        <Stack spacing={0.5} sx={{ alignItems: "flex-start" }}>
          <Typography variant="captionMuted">
            {unavailable.join(" and ")} sign-in is not configured. You can use email and password.
          </Typography>
          <Button
            type="button"
            size="small"
            disabled={options.isFetching}
            onClick={() => void options.refetch()}
          >
            {options.isFetching ? "Checking…" : "Refresh sign-in options"}
          </Button>
        </Stack>
      )}
    </Stack>
  );
}
