import type { ReactElement } from "react";
import { ExpandMore } from "@mui/icons-material";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import type { EvaluationResult } from "@openapply/contracts/scoring-evaluation";
import { evaluationMetric } from "./evaluation-display";

interface ScoringResultProps {
  slot: "baseline" | "candidate";
  result: EvaluationResult | undefined;
}

const ORIGINS = {
  historical: "Historical result",
  simulated: "Simulated result",
  local_inference: "Local inference",
};

export function ScoringResult(props: ScoringResultProps): ReactElement {
  const { slot, result } = props;
  if (!result) return <Typography data-scoring-slot={slot}>{slot}: Unrun</Typography>;
  const assessment = result.assessment;
  return (
    <Stack spacing={1} data-scoring-slot={slot} data-scoring-result-origin={result.origin}>
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
        <Chip label={`${slot}: ${result.status.replaceAll("_", " ")}`} size="small" />
        <Chip label={ORIGINS[result.origin]} size="small" />
      </Stack>
      {result.origin === "historical" && (
        <Typography variant="body2">
          Historical model: Unavailable. No model was requested for this historical reference in
          this evaluation.
        </Typography>
      )}
      {result.origin !== "historical" && (
        <Typography variant="body2">
          Requested model: {result.requestedModel} · Observed models:{" "}
          {result.actualModels.join(", ") || "Unavailable"} · Model version:{" "}
          {result.modelVersion || "Unavailable"}
        </Typography>
      )}
      <Typography variant="body2">
        Score: {evaluationMetric(assessment?.score ?? null)} · Result verification:{" "}
        {result.verification} · Telemetry: {result.telemetry.provenance.replaceAll("_", " ")}
      </Typography>
      {result.failureCode && (
        <Alert severity="warning">Result excluded: {result.failureCode.replaceAll("_", " ")}</Alert>
      )}
      {result.validationReason && (
        <Typography variant="body2" color="text.secondary">
          {result.validationReason}
        </Typography>
      )}
      {assessment && (
        <Accordion slotProps={{ transition: { unmountOnExit: true } }}>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Typography>{slot} validated assessment</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={1.5}>
              <Typography variant="body2">{assessment.judgment}</Typography>
              <Typography variant="body2">{assessment.matchReason}</Typography>
              <Typography variant="body2">
                Role: {assessment.roleMatch.family} ·{" "}
                {assessment.roleMatch.relevance.replaceAll("_", " ")} · Verdict:{" "}
                {assessment.verdict.replaceAll("_", " ")}
              </Typography>
              {assessment.assessments.map((criterion) => (
                <Stack key={criterion.criterionId} spacing={0.5}>
                  <Typography variant="body2Strong">{criterion.criterion.text}</Typography>
                  <Typography variant="body2">
                    {criterion.rating.replaceAll("_", " ")}: {criterion.explanation}
                  </Typography>
                  {criterion.evidence.map((evidence) => (
                    <Typography
                      key={`${evidence.start}:${evidence.end}`}
                      variant="body2"
                      color="text.secondary"
                    >
                      Original resume [{evidence.start}–{evidence.end}]: “{evidence.quote}”
                    </Typography>
                  ))}
                </Stack>
              ))}
            </Stack>
          </AccordionDetails>
        </Accordion>
      )}
    </Stack>
  );
}
