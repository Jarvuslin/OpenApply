import type { ReactElement } from "react";
import {
  Alert,
  Card,
  CardContent,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import type { EvaluationReport } from "@openapply/contracts/scoring-evaluation";
import { evaluationCoverageLabel, evaluationMetric } from "./evaluation-display";
import { ScoringUsage } from "./scoring-usage";

interface ScoringReportProps {
  report: EvaluationReport;
}

const COUNTS = {
  totalCases: "Total cases",
  validPairs: "Valid pairs",
  measuredPairs: "Measured pairs",
  excludedPairs: "Excluded pairs",
  failedCases: "Failed cases",
  unrunCases: "Unrun cases",
  incompleteCases: "Incomplete cases",
};
const METRICS = {
  exactScoreAgreement: "Exact score agreement",
  meanAbsoluteScoreDifference: "Mean absolute score difference",
  cutoffAgreement: "Cutoff agreement",
  candidatePassBaselineFail: "Candidate passes; baseline fails",
  candidateFailBaselinePass: "Candidate fails; baseline passes",
  decisionDisagreements: "Decision disagreements",
  roleDisagreements: "Role disagreements",
  preferenceDisagreements: "Preference disagreements",
  escalationCases: "Escalation cases",
};

function metric(report: EvaluationReport["comparison"], key: keyof typeof METRICS): string {
  if (report.pairs === 0) return "Not measured";
  const value = report[key];
  if (key === "exactScoreAgreement" || key === "cutoffAgreement")
    return evaluationMetric(value === null ? null : value * 100, "%");
  return evaluationMetric(value);
}

export function ScoringReport(props: ScoringReportProps): ReactElement {
  const { report } = props;
  return (
    <Stack
      spacing={2}
      data-scoring-report-id={report.run.id}
      data-scoring-measured-pairs={report.measuredPairs}
    >
      <Typography variant="h5">{evaluationCoverageLabel(report)}</Typography>
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
        {Object.entries(COUNTS).map(([key, label]) => (
          <Chip
            key={key}
            data-scoring-count={key}
            label={`${label}: ${report[key as keyof typeof COUNTS]}`}
          />
        ))}
      </Stack>
      <Typography variant="body2" color="text.secondary">
        Valid pairs have two validated results. Excluded pairs have valid comparisons but lack
        compatible observed model provenance for provider measurements. Failed, unrun and incomplete
        cases stay visible in the total.
      </Typography>
      <Alert severity="info">
        Historical judgments are references, not ground truth. Simulated and historical results are
        excluded from measured provider comparisons. Production scores and defaults are unchanged.
      </Alert>
      <TableContainer component={Card} variant="outlined">
        <Table size="small" aria-label="Scoring comparison metrics">
          <TableHead>
            <TableRow>
              <TableCell>Metric</TableCell>
              <TableCell>All validated pairs ({report.comparison.pairs})</TableCell>
              <TableCell>Measured provider pairs ({report.measured.pairs})</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {Object.entries(METRICS).map(([key, label]) => (
              <TableRow key={key} data-scoring-metric={key}>
                <TableCell component="th" scope="row">
                  {label}
                </TableCell>
                <TableCell>{metric(report.comparison, key as keyof typeof METRICS)}</TableCell>
                <TableCell>{metric(report.measured, key as keyof typeof METRICS)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <ScoringUsage usage={report.usage} />
      {report.limitations.length > 0 && (
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={1}>
              <Typography variant="h6">Measurement limits</Typography>
              {report.limitations.map((limitation) => (
                <Typography key={limitation} variant="body2">
                  {limitation}
                </Typography>
              ))}
            </Stack>
          </CardContent>
        </Card>
      )}
    </Stack>
  );
}
