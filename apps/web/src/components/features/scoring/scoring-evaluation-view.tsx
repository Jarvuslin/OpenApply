"use client";

import type { ReactElement } from "react";
import { Alert, Button, LinearProgress, Stack, Typography } from "@mui/material";
import { useApiQuery } from "@/api/hooks";
import { scoreEvaluationQueries } from "@/api/score-evaluation-queries";
import { PaginationFooter } from "@/components/ui/data";
import { useHydrated } from "@/hooks/use-hydrated";
import { usePaginationParams } from "@/hooks/use-pagination";
import { ScoringCaseCard } from "./scoring-case-card";
import { ScoringReport } from "./scoring-report";
import { ScoringRunSummary } from "./scoring-run-summary";

interface ScoringEvaluationViewProps {
  runId: string;
}

export function ScoringEvaluationView(props: ScoringEvaluationViewProps): ReactElement {
  const hydrated = useHydrated();
  if (!hydrated) return <LinearProgress aria-label="Loading evaluation report" />;
  return <ScoringEvaluationContent runId={props.runId} />;
}

function ScoringEvaluationContent(props: ScoringEvaluationViewProps): ReactElement {
  const { runId } = props;
  const pagination = usePaginationParams();
  const report = useApiQuery(scoreEvaluationQueries.report(runId), { retry: false });
  const cases = useApiQuery(scoreEvaluationQueries.cases(runId, pagination.query), {
    retry: false,
  });
  return (
    <Stack spacing={2}>
      <Button
        disabled={report.isFetching || cases.isFetching}
        onClick={() => {
          void report.refetch();
          void cases.refetch();
        }}
      >
        Refresh report
      </Button>
      {report.isLoading && <LinearProgress aria-label="Loading evaluation report" />}
      {report.error && (
        <Alert
          severity="error"
          action={<Button onClick={() => void report.refetch()}>Retry report</Button>}
        >
          Could not load the evaluation report.
        </Alert>
      )}
      {report.data && (
        <>
          <Typography variant="h4">{report.data.run.name}</Typography>
          <ScoringRunSummary run={report.data.run} />
          <ScoringReport report={report.data} />
        </>
      )}
      <Typography variant="h5">Case evidence</Typography>
      {cases.isLoading && <LinearProgress aria-label="Loading evaluation cases" />}
      {cases.error && (
        <Alert
          severity="error"
          action={<Button onClick={() => void cases.refetch()}>Retry cases</Button>}
        >
          Could not load evaluation cases. The aggregate above covers the whole run.
        </Alert>
      )}
      {!cases.isLoading && !cases.error && cases.data?.items.length === 0 && (
        <Typography>No cases on this page.</Typography>
      )}
      {cases.data?.items.map((item) => (
        <ScoringCaseCard key={item.id} item={item} />
      ))}
      {cases.data && (
        <PaginationFooter
          pagination={cases.data.pagination}
          onPageChange={pagination.setPage}
          onPageSizeChange={pagination.setPageSize}
        />
      )}
    </Stack>
  );
}
