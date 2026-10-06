"use client";

import { type ReactElement, useEffect } from "react";
import { Alert, Button, Stack } from "@mui/material";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiError } from "@/api/error";
import { useSession } from "@/hooks/use-auth";
import { loginDestination } from "@/utils/login-destination";
import { AuthFormSkeleton } from "./auth-form-skeleton";
import { LoginForm } from "./login-form";

export function LoginSession(): ReactElement {
  const router = useRouter();
  const params = useSearchParams();
  const { isAuthenticated, isLoading, meQuery } = useSession({ fresh: true });
  const destination = loginDestination(params.get("next"));
  const checking = isLoading || meQuery.isFetching;
  const signedOut = meQuery.error instanceof ApiError && meQuery.error.status === 401;

  useEffect(() => {
    if (isAuthenticated && !checking && !meQuery.error) router.replace(destination);
  }, [isAuthenticated, checking, meQuery.error, router, destination]);

  if (checking) return <AuthFormSkeleton />;
  if (signedOut) return <LoginForm />;
  if (meQuery.error) {
    return (
      <Stack spacing={2}>
        <Alert severity="warning">
          Unable to check your session. Your sign-in has not been cleared.
        </Alert>
        <Button variant="outlined" onClick={() => meQuery.refetch()}>
          Retry connection
        </Button>
      </Stack>
    );
  }
  return <AuthFormSkeleton />;
}
