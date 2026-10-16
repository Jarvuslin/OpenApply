import type { ReactElement } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import { API_BASE_URL } from "@/api/base-url";
import type { ApplicationDetailDto } from "@/api/types";
import { EmptyState } from "@/components/ui/data";
import { ExternalLink, LabelValue } from "@/components/ui/display";
import { SectionCard } from "@/components/ui/layout";
import { formatAbsoluteTime } from "@/utils/format";

interface SubmissionRecordProps {
  application: ApplicationDetailDto;
}

export function SubmissionRecord({ application }: SubmissionRecordProps): ReactElement {
  const record = application.submission;
  if (!record) {
    return (
      <SectionCard title="Submission record">
        <EmptyState
          variant="inline"
          title="Answers, confirmation and an exact PDF copy were not retained for this application."
        />
      </SectionCard>
    );
  }

  return (
    <>
      <RecordContent record={record} applicationId={application.id} />
      {record.previous.map((previous) => (
        <Accordion key={`${previous.resume.jobId}-${previous.confirmation.observedAt}`}>
          <AccordionSummary>
            Previous submission · {formatAbsoluteTime(previous.confirmation.observedAt)}
          </AccordionSummary>
          <AccordionDetails>
            <RecordContent record={previous} applicationId={application.id} />
          </AccordionDetails>
        </Accordion>
      ))}
    </>
  );
}

interface RecordContentProps {
  record: NonNullable<ApplicationDetailDto["submission"]>["previous"][number];
  applicationId: string;
}

function RecordContent({ record, applicationId }: RecordContentProps): ReactElement {
  return (
    <>
      <SectionCard
        title="Submission confirmation"
        description="Employer confirmation captured by the application agent."
      >
        <Stack spacing={2}>
          <LabelValue label="Observed at">
            {formatAbsoluteTime(record.confirmation.observedAt)}
          </LabelValue>
          {record.confirmation.reference && (
            <LabelValue label="Receipt reference">{record.confirmation.reference}</LabelValue>
          )}
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {record.confirmation.text}
          </Typography>
          <ExternalLink href={record.confirmation.url}>Confirmation page</ExternalLink>
          <Link
            href={`${API_BASE_URL}/api/applied/${applicationId}/submitted-resume?sha256=${record.resume.sha256}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Submitted PDF: {record.resume.filename}
          </Link>
          <Typography variant="caption" sx={{ overflowWrap: "anywhere" }}>
            SHA-256: {record.resume.sha256}
          </Typography>
        </Stack>
      </SectionCard>
      <SectionCard
        title="Submitted answers"
        description="The field values verified in the form before submission. Credentials and verification codes are redacted."
      >
        <Stack spacing={2}>
          {record.fields.map((field) => (
            <Stack key={field.id} spacing={0.5}>
              <Typography variant="body2">
                {field.section ? `${field.section} · ${field.label}` : field.label}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {field.type}
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {fieldValue(field)}
              </Typography>
            </Stack>
          ))}
        </Stack>
      </SectionCard>
    </>
  );
}

export function fieldValue(field: {
  redacted?: boolean;
  value: string | string[] | boolean | null;
}): string {
  if (field.redacted) return "Redacted";
  if (field.value === null || field.value === "") return "No value";
  if (typeof field.value === "boolean") return field.value ? "Yes" : "No";
  return Array.isArray(field.value) ? field.value.join(", ") : field.value;
}
