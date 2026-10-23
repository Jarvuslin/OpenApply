"use client";

import { type ReactElement, useState } from "react";
import { Alert, Button, LinearProgress, Link, Stack } from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod/v4";
import { accountSetupQueries } from "@/api/account-setup-queries";
import { useApiQuery } from "@/api/hooks";
import { invalidations, queryKeys } from "@/api/query-keys";
import { SectionCard } from "@/components/ui/layout";
import { useSession } from "@/hooks/use-auth";
import { useHydrated } from "@/hooks/use-hydrated";
import { AccountSetupLaunch } from "./account-setup-launch";
import { AccountSetupResponse } from "./account-setup-response";
import { accountSetupPresentation } from "./account-setup-state";
import { AccountSetupSummary } from "./account-setup-summary";

interface AccountSetupViewProps {
  id: string;
}

export function AccountSetupView({ id }: AccountSetupViewProps): ReactElement {
  const hydrated = useHydrated();
  const { user } = useSession();
  if (!z.uuid().safeParse(id).success)
    return <Alert severity="error">This account setup link is invalid.</Alert>;
  if (!hydrated || !user) return <LinearProgress aria-label="Loading employer account" />;
  return <AccountSetupContent key={`${user.id}:${id}`} id={id} />;
}

function AccountSetupContent({ id }: AccountSetupViewProps): ReactElement {
  const query = useApiQuery(accountSetupQueries.detail(id), {
    retry: false,
    refetchInterval: 5000,
  });
  const client = useQueryClient();
  const [reviewVersion, setReviewVersion] = useState(0);
  const detail = query.error ? undefined : query.data;
  async function refresh(): Promise<void> {
    await query.refetch();
    for (const queryKey of [...invalidations.questions, queryKeys.credentials.all])
      void client.invalidateQueries({ queryKey });
  }
  async function reload(): Promise<void> {
    const result = await query.refetch();
    if (!result.error) setReviewVersion((current) => current + 1);
  }
  return (
    <SectionCard title="Account setup status">
      <Stack spacing={2}>
        {query.isLoading && <LinearProgress aria-label="Loading saved account state" />}
        {query.error && (
          <Alert severity="error">
            Could not load the current account. No actions are available until its state can be
            checked.
          </Alert>
        )}
        <Stack direction="row" spacing={2}>
          <Button onClick={() => void reload()}>Reload account state</Button>
          <Link href="/queue">Queue</Link>
          <Link href="/needs-you">Needs you</Link>
        </Stack>
        {detail && (
          <>
            <AccountSetupSummary detail={detail} />
            <AccountSetupResponse
              key={`response:${reviewVersion}:${detail.context.snapshot.revision}:${detail.item.state}:${detail.context.attempt.phase}:${detail.context.attempt.questionId}`}
              detail={detail}
              onUpdated={refresh}
            />
            {accountSetupPresentation(detail).launch && (
              <AccountSetupLaunch
                key={`launch:${detail.context.snapshot.snapshotHash}`}
                detail={detail}
                onUpdated={refresh}
              />
            )}
          </>
        )}
      </Stack>
    </SectionCard>
  );
}
