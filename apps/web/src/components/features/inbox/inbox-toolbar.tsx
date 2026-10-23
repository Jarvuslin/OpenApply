"use client";

import type { ReactElement } from "react";
import { CloudSync } from "@mui/icons-material";
import { Button, Stack, ToggleButton, ToggleButtonGroup, Tooltip } from "@mui/material";
import { api } from "@/api/client";
import { useApiMutation, useApiQuery } from "@/api/hooks";
import { emailQueries, type InboxFilter } from "@/api/queries";
import { queryKeys } from "@/api/query-keys";
import type { SyncResultDto } from "@/api/types";

interface InboxToolbarProps {
  filter: InboxFilter;
  onFilterChange: (next: InboxFilter) => void;
}

const FILTERS: ReadonlyArray<{ key: InboxFilter; label: string }> = [
  { key: "pending", label: "Pending" },
  { key: "auto", label: "Auto" },
  { key: "approved", label: "Approved" },
  { key: "denied", label: "Denied" },
  { key: "all", label: "All" },
];

export function InboxToolbar(props: InboxToolbarProps): ReactElement {
  const { filter, onFilterChange } = props;
  const account = useApiQuery(emailQueries.account());
  const connector = account.data?.connected && account.data.provider === "connector";
  const sync = useApiMutation<SyncResultDto, void>(() => api.email.sync.post(), {
    successMessage: "Inbox synced",
    invalidate: [queryKeys.email.all],
  });

  return (
    <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", alignItems: "center" }}>
      {!connector && (
        <Tooltip title="Fetch new mail from Gmail">
          <Button
            size="small"
            variant="outlined"
            startIcon={<CloudSync />}
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
          >
            {sync.isPending ? "Syncing" : "Sync"}
          </Button>
        </Tooltip>
      )}
      <ToggleButtonGroup
        size="small"
        exclusive
        value={filter}
        onChange={(_, next: InboxFilter | null) => {
          if (next !== null) {
            onFilterChange(next);
          }
        }}
        sx={{ ml: { sm: "auto" }, flexWrap: "wrap" }}
      >
        {FILTERS.map((f) => (
          <ToggleButton key={f.key} value={f.key}>
            {f.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Stack>
  );
}
