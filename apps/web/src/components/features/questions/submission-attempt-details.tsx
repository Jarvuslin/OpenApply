import type { ReactElement } from "react";
import { ExpandMore } from "@mui/icons-material";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import type { SubmissionAttemptView } from "@openapply/contracts/submission";
import { API_BASE_URL } from "@/api/base-url";
import { fieldValue } from "@/components/features/applications/submission-record";
import { formatAbsoluteTime } from "@/utils/format";

const STATES = {
  prepared: {
    title: "Prepared for submission",
    description:
      "Reviewed answers and the exact resume PDF are saved. Submission permission has not been issued.",
    severity: "info",
  },
  unknown: {
    title: "Submission outcome unknown",
    description:
      "The application may have been submitted. Recover the existing employer confirmation before recording it. Do not submit again.",
    severity: "warning",
  },
  recording_pending: {
    title: "Confirmation received · recording pending",
    description:
      "The employer confirmation is saved. Finish recording this application from the saved receipt without submitting again.",
    severity: "info",
  },
  recorded: {
    title: "Application recorded",
    description:
      "The application record was saved using the retained checkpoint and employer confirmation.",
    severity: "success",
  },
} as const;

interface SubmissionAttemptDetailsProps {
  attempt: SubmissionAttemptView;
  campaignId: string;
  jobKey: string;
}

export function SubmissionAttemptDetails(props: SubmissionAttemptDetailsProps): ReactElement {
  const { attempt, campaignId, jobKey } = props;
  const state = STATES[attempt.state];
  const { checkpoint, receipt } = attempt;
  const checkpointPdf = `${API_BASE_URL}/api/campaigns/${encodeURIComponent(campaignId)}/jobs/${encodeURIComponent(jobKey)}/submission-checkpoints/${attempt.checkpointId}/pdf`;
  return (
    <Stack spacing={2}>
      <Alert severity={state.severity}>
        <Typography variant="subtitle2">{state.title}</Typography>
        <Typography variant="body2">{state.description}</Typography>
      </Alert>
      {attempt.legacyOutcomeUnknown && (
        <Typography variant="body2">
          This earlier application was in progress before durable checkpoints were available. Its
          missing fields, resume copy and attempt time have not been reconstructed.
        </Typography>
      )}
      {attempt.startedAt && (
        <Typography variant="body2">
          Submission permission issued: {formatAbsoluteTime(attempt.startedAt)}. This timestamp does
          not confirm that Submit was clicked or received.
        </Typography>
      )}
      {receipt && (
        <Stack spacing={1}>
          <Typography variant="subtitle2">Employer confirmation</Typography>
          <Typography variant="body2">
            Observed: {formatAbsoluteTime(receipt.confirmation.observedAt)}
          </Typography>
          {attempt.receiptStoredAt && (
            <Typography variant="body2">
              Saved: {formatAbsoluteTime(attempt.receiptStoredAt)}
            </Typography>
          )}
          {receipt.confirmation.reference && (
            <Typography variant="body2">Reference: {receipt.confirmation.reference}</Typography>
          )}
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {receipt.confirmation.text}
          </Typography>
          <Link href={receipt.confirmation.url} target="_blank" rel="noopener noreferrer">
            Confirmation page
          </Link>
        </Stack>
      )}
      {attempt.recordedAt && (
        <Typography variant="body2">
          Application record saved: {formatAbsoluteTime(attempt.recordedAt)}
        </Typography>
      )}
      {attempt.applicationId && (
        <Link href={`/applications/${attempt.applicationId}`}>View application record</Link>
      )}
      {checkpoint && (
        <Stack spacing={1}>
          <Typography variant="subtitle2">Saved preparation</Typography>
          <Typography variant="body2">
            {checkpoint.job.title} · {checkpoint.job.company}
          </Typography>
          <Typography variant="body2">
            Reviewed: {formatAbsoluteTime(checkpoint.review.reviewedAt)}
          </Typography>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
            {checkpoint.review.summary}
          </Typography>
          <Link href={checkpointPdf} target="_blank" rel="noopener noreferrer">
            Retained PDF: {checkpoint.resume.filename}
          </Link>
          <Typography variant="caption" sx={{ overflowWrap: "anywhere" }}>
            SHA-256: {checkpoint.resume.sha256}
          </Typography>
          <Accordion disableGutters>
            <AccordionSummary expandIcon={<ExpandMore />}>
              <Typography variant="body2">
                Reviewed form answers ({checkpoint.fields.length})
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={2}>
                {checkpoint.fields.map((field) => (
                  <Stack key={field.id} spacing={0.5}>
                    <Typography variant="body2">
                      {field.section ? `${field.section} · ${field.label}` : field.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {field.type}
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                    >
                      {fieldValue(field)}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </AccordionDetails>
          </Accordion>
        </Stack>
      )}
    </Stack>
  );
}
