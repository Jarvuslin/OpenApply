import type { ReactElement } from "react";
import {
  Card,
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
import { evaluationMetric } from "./evaluation-display";

interface ScoringUsageProps {
  usage: EvaluationReport["usage"];
}

const MEASURES = {
  latencyMs: "Latency (ms)",
  requests: "Requests",
  inputTokens: "Input tokens",
  cacheWriteTokens: "Cache write tokens",
  cacheReadTokens: "Cache read tokens",
  outputTokens: "Output tokens",
};

export function ScoringUsage(props: ScoringUsageProps): ReactElement {
  const { usage } = props;
  return (
    <Stack spacing={1.5}>
      <Typography variant="h6">Recorded local execution usage</Typography>
      <Typography variant="body2" color="text.secondary">
        Includes failed local executions when metadata is available. Token and request counts
        require observed provider metadata; latency may come from the local clock. Missing
        measurements remain unavailable. These counts do not measure Claude Pro allowance or a bill.
      </Typography>
      {(["baseline", "candidate"] as const).map((slot) => (
        <TableContainer key={slot} component={Card} variant="outlined">
          <Table size="small" aria-label={`${slot} execution usage`}>
            <TableHead>
              <TableRow>
                <TableCell>
                  {slot} · {usage[slot].results} local results
                </TableCell>
                <TableCell>Available</TableCell>
                <TableCell>Unavailable</TableCell>
                <TableCell>Total</TableCell>
                <TableCell>Mean</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {Object.entries(MEASURES).map(([key, label]) => {
                const value = usage[slot][key as keyof typeof MEASURES];
                return (
                  <TableRow key={key}>
                    <TableCell component="th" scope="row">
                      {label}
                    </TableCell>
                    <TableCell>{value.available}</TableCell>
                    <TableCell>{value.unavailable}</TableCell>
                    <TableCell>{evaluationMetric(value.total)}</TableCell>
                    <TableCell>{evaluationMetric(value.mean)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      ))}
    </Stack>
  );
}
