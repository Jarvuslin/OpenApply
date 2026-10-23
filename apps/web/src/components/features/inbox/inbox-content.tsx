"use client";

import { type ReactElement, useState } from "react";
import { Alert, Button, LinearProgress, Stack } from "@mui/material";
import { inboxChannel } from "@openapply/contracts/sse";
import { useQueryClient } from "@tanstack/react-query";
import { useApiQuery } from "@/api/hooks";
import { emailQueries, type InboxFilter } from "@/api/queries";
import { queryKeys } from "@/api/query-keys";
import { MailboxReauthAlert } from "@/components/features/settings/sections/mailbox-reauth-alert";
import { LinkButton } from "@/components/ui/buttons";
import { EmptyState } from "@/components/ui/data/empty-state";
import { gridPagination, usePaginationParams } from "@/hooks/use-pagination";
import { useSseChannel } from "@/lib/sse/client";
import { InboxTable } from "./inbox-table";
import { InboxToolbar } from "./inbox-toolbar";
import { MessageReviewDialog } from "./message-review-dialog";

export function InboxContent(): ReactElement {
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const account = useApiQuery(emailQueries.account());

  const status = account.data;
  const connected = status?.connected === true;

  const pagination = usePaginationParams();
  const messages = useApiQuery(emailQueries.messages(filter, pagination.query), {
    enabled: connected,
  });

  useSseChannel(inboxChannel, null, {
    enabled: connected,
    onMessage: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.email.all });
    },
  });

  if (account.isLoading) {
    return <LinearProgress />;
  }

  if (account.error || !status) {
    return (
      <Alert
        severity="error"
        action={<Button onClick={() => void account.refetch()}>Retry</Button>}
      >
        Could not load your mailbox connection.
      </Alert>
    );
  }

  if (!status.connected) {
    return (
      <EmptyState
        title="No mailbox connected"
        description="OpenApply reads new mail to track recruiter replies and auto-fill verification codes. Connect Gmail to get started."
        action={
          <LinkButton href="/queue#login" variant="contained">
            Connect Gmail
          </LinkButton>
        }
      />
    );
  }

  return (
    <Stack spacing={2}>
      {status.needsReauth && (
        <MailboxReauthAlert
          action={
            <LinkButton href="/queue#login" color="inherit" size="small">
              Reconnect
            </LinkButton>
          }
        />
      )}
      <InboxToolbar
        filter={filter}
        onFilterChange={(next) => {
          setFilter(next);
          pagination.setPage(1);
        }}
      />
      {messages.isLoading && <LinearProgress />}
      {messages.error && (
        <Alert
          severity="error"
          action={<Button onClick={() => void messages.refetch()}>Retry</Button>}
        >
          Could not load your inbox.
        </Alert>
      )}
      {!messages.isLoading && !messages.error && (
        <InboxTable
          rows={messages.data?.items ?? []}
          loading={messages.isFetching}
          {...gridPagination(pagination, messages.data?.pagination)}
          onRowClick={(row) => setSelectedId(row.id)}
        />
      )}
      <MessageReviewDialog
        messageId={selectedId}
        open={selectedId !== null}
        onClose={() => setSelectedId(null)}
      />
    </Stack>
  );
}
