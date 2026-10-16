"use client";

import { type ReactElement, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  LinearProgress,
  Link,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useForm } from "@tanstack/react-form";
import type { Route } from "next";
import NextLink from "next/link";
import { useApiQuery } from "@/api/hooks";
import { resumeQueries } from "@/api/queries";
import { ArtifactPreview } from "@/components/features/resumes/detail/artifact-preview";
import type { DocumentChoice } from "./document-choice";

interface ResumePdfPickerProps {
  disabled: boolean;
  busy: boolean;
  onSelect: (choice: DocumentChoice) => Promise<void>;
}

export function ResumePdfPicker(props: ResumePdfPickerProps): ReactElement {
  const { disabled, busy, onSelect } = props;
  const resumes = useApiQuery(resumeQueries.list());
  const [resumeId, setResumeId] = useState("");
  const selected = resumes.data?.find((item) => item.id === resumeId);
  return (
    <Stack spacing={1.5}>
      {resumes.isLoading && <LinearProgress aria-label="Loading owned resumes" />}
      {resumes.error && (
        <Alert
          severity="error"
          action={<Button onClick={() => void resumes.refetch()}>Retry resumes</Button>}
        >
          Could not load your saved resumes.
        </Alert>
      )}
      <TextField
        select
        label="Saved resume for this upload"
        value={resumeId}
        disabled={disabled || busy || resumes.isLoading || !!resumes.error}
        onChange={(event) => setResumeId(event.target.value)}
      >
        <MenuItem value="">Choose explicitly</MenuItem>
        {resumes.data?.map((resume) => (
          <MenuItem key={resume.id} value={resume.id}>
            {resume.label}
          </MenuItem>
        ))}
      </TextField>
      {resumes.data?.length === 0 && (
        <Link component={NextLink} href="/profile">
          Upload a resume first
        </Link>
      )}
      {selected && (
        <ResumeVariantChoice
          key={selected.id}
          resumeId={selected.id}
          updatedAt={selected.updatedAt}
          disabled={disabled}
          busy={busy}
          onSelect={onSelect}
        />
      )}
    </Stack>
  );
}

interface ResumeVariantChoiceProps extends ResumePdfPickerProps {
  resumeId: string;
  updatedAt: Date | string;
}

function ResumeVariantChoice(props: ResumeVariantChoiceProps): ReactElement {
  const { resumeId, updatedAt, disabled, busy, onSelect } = props;
  const variants = useApiQuery(resumeQueries.variants(resumeId));
  const [variantId, setVariantId] = useState("");
  const selected = variants.data?.find((item) => item.id === variantId);
  return (
    <Stack spacing={1.5}>
      {variants.error && (
        <Alert
          severity="error"
          action={<Button onClick={() => void variants.refetch()}>Retry variants</Button>}
        >
          Could not load tailored variants. The saved base remains available.
        </Alert>
      )}
      <TextField
        select
        label="Resume version for this upload"
        value={variantId}
        disabled={disabled || busy || variants.isLoading}
        onChange={(event) => setVariantId(event.target.value)}
      >
        <MenuItem value="">Saved base resume</MenuItem>
        {variants.data?.map((variant) => (
          <MenuItem key={variant.id} value={variant.id}>
            {variant.label}
            {variant.jobUrl && ` · ${variant.jobUrl}`}
          </MenuItem>
        ))}
      </TextField>
      {(!variantId || selected) && (
        <PdfArtifactChoice
          key={`${resumeId}:${variantId}`}
          resumeId={resumeId}
          variantId={variantId || undefined}
          updatedAt={selected?.updatedAt ?? updatedAt}
          disabled={disabled}
          busy={busy}
          onSelect={onSelect}
        />
      )}
    </Stack>
  );
}

interface PdfArtifactChoiceProps extends ResumeVariantChoiceProps {
  variantId?: string;
}

function PdfArtifactChoice(props: PdfArtifactChoiceProps): ReactElement {
  const { resumeId, variantId, updatedAt, disabled, busy, onSelect } = props;
  const query = useApiQuery(resumeQueries.artifact(resumeId, variantId, updatedAt));
  const artifact = query.data?.artifact;
  return (
    <Stack spacing={1.5}>
      {query.isLoading && <LinearProgress aria-label="Loading exact PDF identity" />}
      {query.error && (
        <Alert
          severity="error"
          action={<Button onClick={() => void query.refetch()}>Retry PDF identity</Button>}
        >
          Could not verify this saved PDF.
        </Alert>
      )}
      {!query.isLoading && !query.error && !artifact && (
        <Alert severity="info">
          This version has no saved canonical PDF.{" "}
          <Link component={NextLink} href={`/resumes/${resumeId}` as Route}>
            Open the resume to generate or review it.
          </Link>
        </Alert>
      )}
      {artifact && (
        <>
          <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
            PDF revision: {artifact.revision}
          </Typography>
          <Typography variant="caption" sx={{ overflowWrap: "anywhere" }}>
            SHA-256: {artifact.pdfSha256} · {artifact.sizeBytes} bytes
          </Typography>
          <ArtifactPreview resumeId={resumeId} variantId={variantId} updatedAt={updatedAt} />
          <PdfSelectionConsent
            key={`${artifact.revision}:${artifact.pdfSha256}`}
            choice={{
              resumeId,
              ...(variantId && { variantId }),
              artifactRevision: artifact.revision,
              pdfSha256: artifact.pdfSha256,
              sizeBytes: artifact.sizeBytes,
            }}
            disabled={disabled || !!query.error}
            busy={busy}
            onSelect={onSelect}
          />
        </>
      )}
    </Stack>
  );
}

interface PdfSelectionConsentProps extends ResumePdfPickerProps {
  choice: DocumentChoice;
}

function PdfSelectionConsent(props: PdfSelectionConsentProps): ReactElement {
  const { choice, disabled, busy, onSelect } = props;
  const form = useForm({
    defaultValues: { confirmed: false },
    onSubmit: async ({ value }) => {
      if (value.confirmed && !disabled && !busy) await onSelect(choice);
    },
  });
  return (
    <Box
      component="form"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">
          Selecting a PDF identifies the file for this upload. Its factual content and the completed
          application still require review before submission.
        </Typography>
        <form.Field name="confirmed">
          {(field) => (
            <FormControlLabel
              label="I choose this exact PDF for this upload."
              control={
                <Checkbox
                  checked={field.state.value}
                  disabled={disabled || busy}
                  onChange={(_, checked) => field.handleChange(checked)}
                />
              }
            />
          )}
        </form.Field>
        <form.Subscribe selector={(state) => state.values.confirmed}>
          {(confirmed) => (
            <Button
              type="submit"
              variant="outlined"
              disabled={disabled || busy || !confirmed}
              loading={busy}
            >
              Use this PDF for this upload
            </Button>
          )}
        </form.Subscribe>
      </Stack>
    </Box>
  );
}
