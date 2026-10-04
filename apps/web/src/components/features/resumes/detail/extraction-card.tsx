"use client";
import { type ReactElement, useEffect, useState } from "react";
import { Alert, Button, CircularProgress, Stack, Typography } from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/api/query-keys";
import { SectionCard } from "@/components/ui/layout";
import { extractUpload } from "../extract-upload";
import { useResumeExtraction } from "../use-resume-extraction";

interface ExtractionCardProps {
  resumeId: string;
  onSkip: () => void;
}
export function ExtractionCard({ resumeId, onSkip }: ExtractionCardProps): ReactElement {
  const queryClient = useQueryClient();
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  useResumeExtraction(resumeId, busy);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is an explicit retry trigger.
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError("");
    void extractUpload(resumeId)
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.resume.all });
      })
      .catch((reason) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : "Could not read the document.");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resumeId, attempt, queryClient]);
  return (
    <SectionCard title={busy ? "Reading your resume" : "Your file is saved"}>
      <Stack spacing={2}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          {busy && <CircularProgress size={18} />}
          <Typography color="text.secondary">
            {busy
              ? "Extracting your experience, education and skills with your Claude subscription. You can keep this page open."
              : "You can retry reading this document without uploading another copy, or enter the details yourself."}
          </Typography>
        </Stack>
        {error && <Alert severity="error">{error}</Alert>}
        <Stack direction="row" spacing={1.5}>
          <Button variant="outlined" onClick={onSkip}>
            Edit manually
          </Button>
          <Button disabled={busy} onClick={() => setAttempt((n) => n + 1)}>
            Retry extraction
          </Button>
        </Stack>
      </Stack>
    </SectionCard>
  );
}
