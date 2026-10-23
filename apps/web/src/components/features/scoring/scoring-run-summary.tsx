import type { ReactElement } from "react";
import { Chip, Stack, Typography } from "@mui/material";
import type { EvaluationRun } from "@openapply/contracts/scoring-evaluation";

interface ScoringRunSummaryProps {
  run: EvaluationRun;
}

const COHORTS = {
  owned: "Owned job snapshots",
  historical_synthetic: "Historical synthetic cases",
  authored: "Authored edge cases",
};

export function ScoringRunSummary(props: ScoringRunSummaryProps): ReactElement {
  const { run } = props;
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
        <Chip label={COHORTS[run.cohort]} size="small" />
        <Chip label={`${run.caseCount} cases`} size="small" />
      </Stack>
      <Typography variant="body2">
        Planned baseline: {run.baselineModel} · Planned candidate: {run.candidateModel} · Escalation
        band: ±{run.escalationBand} points
      </Typography>
      <Typography variant="caption" color="text.secondary">
        Created {new Date(run.createdAt).toLocaleString()} · Evaluation policy {run.policyVersion}
      </Typography>
    </Stack>
  );
}
