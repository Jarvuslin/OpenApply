"use client";

import type { ReactElement, ReactNode } from "react";
import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import { workspaceChannel } from "@openapply/contracts/sse";
import { useQueryClient } from "@tanstack/react-query";
import { useApiQuery } from "@/api/hooks";
import { analyticsQueries } from "@/api/queries";
import { queryKeys } from "@/api/query-keys";
import { useSseChannel } from "@/lib/sse/client";
import { AgentCard } from "./agent-card";
import { ApplicationOutcomesChart } from "./application-outcomes-chart";
import { DashboardMetrics } from "./core-metrics";
import { MatchScoreCard } from "./match-score-card";
import { MonthApplicationsChart } from "./month-applications-chart";

// Wide left column, narrow right one, the same split on every row so card edges line up.
const COLUMNS = { xs: "minmax(0, 1fr)", md: "minmax(0, 5fr) minmax(0, 3fr)" };
const PAIR = { xs: "minmax(0, 1fr)", sm: "minmax(0, 1fr) minmax(0, 1fr)" };

interface AnalyticsViewProps {
  /** The running searches, shown beside the agent card. */
  searches: ReactNode;
}

export function AnalyticsView({ searches }: AnalyticsViewProps): ReactElement {
  const queryClient = useQueryClient();
  useSseChannel(workspaceChannel, null, {
    onMessage: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.analytics.all });
    },
  });
  const query = useApiQuery(analyticsQueries.stats());
  const retryAction = (
    <Button color="inherit" disabled={query.isFetching} onClick={() => query.refetch()}>
      {query.isFetching ? "Retrying" : "Retry"}
    </Button>
  );

  if (query.isPending) {
    return (
      <Stack spacing={2}>
        <Typography variant="body2Muted">Loading analytics</Typography>
        {searches}
      </Stack>
    );
  }

  if (!query.data) {
    return (
      <Stack spacing={2}>
        <Alert severity="error" action={retryAction}>
          Could not load analytics.
        </Alert>
        {searches}
      </Stack>
    );
  }

  const stats = query.data;

  return (
    <Stack spacing={2}>
      {query.isError && (
        <Alert severity="warning" action={retryAction}>
          Analytics refresh failed. Showing the last loaded data.
        </Alert>
      )}
      <DashboardMetrics stats={stats} />
      <Box sx={{ display: "grid", gridTemplateColumns: COLUMNS, gap: 2 }}>
        {searches}
        <AgentCard stats={stats} />
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: COLUMNS, gap: 2 }}>
        <Box sx={{ display: "grid", gridTemplateColumns: PAIR, gap: 2 }}>
          <MonthApplicationsChart data={stats.perDay} />
          <ApplicationOutcomesChart data={stats.outcomes} />
        </Box>
        <MatchScoreCard data={stats.matchScore} />
      </Box>
    </Stack>
  );
}
