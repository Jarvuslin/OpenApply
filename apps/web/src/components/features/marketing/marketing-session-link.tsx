"use client";

import type { ReactElement } from "react";
import { Button, Skeleton } from "@mui/material";
import { ApiError } from "@/api/error";
import { LinkButton } from "@/components/ui/buttons";
import { useSession } from "@/hooks/use-auth";

/** Public pages share the app session; never suggest signing in while it is loading. */
export function MarketingSessionLink(): ReactElement {
  const { isAuthenticated, meQuery } = useSession();

  if (meQuery.isPending) {
    return <Skeleton variant="rounded" width={96} height={32} aria-label="Checking sign-in" />;
  }

  if (
    !isAuthenticated &&
    meQuery.error &&
    (!(meQuery.error instanceof ApiError) || meQuery.error.status !== 401)
  ) {
    return (
      <Button size="small" disabled={meQuery.isFetching} onClick={() => void meQuery.refetch()}>
        {meQuery.isFetching ? "Checking…" : "Retry connection"}
      </Button>
    );
  }

  return (
    <LinkButton href={isAuthenticated ? "/workspace" : "/login"} variant="text" size="small">
      {isAuthenticated ? "Dashboard" : "Sign in"}
    </LinkButton>
  );
}
