"use client";

import type { ReactElement } from "react";
import {
  Alert,
  Button,
  Card,
  CardContent,
  LinearProgress,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import type { Route } from "next";
import NextLink from "next/link";
import { useApiQuery } from "@/api/hooks";
import { scoreEvaluationQueries } from "@/api/score-evaluation-queries";
import { PaginationFooter } from "@/components/ui/data";
import { useHydrated } from "@/hooks/use-hydrated";
import { usePaginationParams } from "@/hooks/use-pagination";
import { ScoringRunSummary } from "./scoring-run-summary";

export function ScoringEvaluationsView(): ReactElement {
  const hydrated = useHydrated();
  if (!hydrated) return <LinearProgress aria-label="Loading scoring evaluations" />;
  return <ScoringEvaluationsContent />;
}

function ScoringEvaluationsContent(): ReactElement {
  const pagination = usePaginationParams();
  const list = useApiQuery(scoreEvaluationQueries.list(pagination.query), { retry: false });
  return (
    <Stack spacing={2}>
      <Alert severity="info">
        These reports are read-only. Opening them does not run a model or change production scores
        or model defaults.
      </Alert>
      <Button disabled={list.isFetching} onClick={() => void list.refetch()}>
        Refresh evaluations
      </Button>
      {list.isLoading && <LinearProgress aria-label="Loading scoring evaluations" />}
      {list.error && (
        <Alert
          severity="error"
          action={<Button onClick={() => void list.refetch()}>Retry evaluations</Button>}
        >
          Could not load scoring evaluations.
        </Alert>
      )}
      {!list.isLoading && !list.error && list.data?.items.length === 0 && (
        <Typography>No scoring evaluations have been saved.</Typography>
      )}
      {list.data?.items.map((run) => (
        <Card key={run.id} variant="outlined" data-scoring-run-id={run.id}>
          <CardContent>
            <Stack spacing={1.5}>
              <Typography variant="h6">{run.name}</Typography>
              <ScoringRunSummary run={run} />
              <Link component={NextLink} href={`/analytics/scoring/${run.id}` as Route}>
                View evaluation report
              </Link>
            </Stack>
          </CardContent>
        </Card>
      ))}
      {list.data && (
        <PaginationFooter
          pagination={list.data.pagination}
          onPageChange={pagination.setPage}
          onPageSizeChange={pagination.setPageSize}
        />
      )}
    </Stack>
  );
}
