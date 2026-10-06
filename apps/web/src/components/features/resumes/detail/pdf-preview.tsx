"use client";

import { type ReactElement, useState } from "react";
import { OpenInNew } from "@mui/icons-material";
import { Button, Paper, Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { resumePdfUrl, resumeSourceUrl } from "@/api/resume-urls";
import type { ResumeDto } from "@/api/types";
import { SectionCard } from "@/components/ui/layout";

interface ResumePdfPreviewProps {
  resume: ResumeDto;
}

export function ResumePdfPreview(props: ResumePdfPreviewProps): ReactElement {
  const { resume } = props;
  const [view, setView] = useState("original");
  const original = Boolean(resume.sourceFilename) && (view === "original" || !resume.content);
  const src = original
    ? resumeSourceUrl(resume.id, resume.updatedAt)
    : resumePdfUrl(resume.id, resume.updatedAt);
  const canPreview = original
    ? resume.sourceMimeType === "application/pdf"
    : Boolean(resume.content);
  return (
    <SectionCard
      title={original ? "Original upload" : "Generated PDF"}
      actions={
        <Button
          size="small"
          endIcon={<OpenInNew fontSize="sm" />}
          component="a"
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          disabled={!resume.sourceFilename && !resume.content}
        >
          Open
        </Button>
      }
    >
      <Stack spacing={1}>
        {resume.sourceFilename && resume.content && (
          <ToggleButtonGroup
            size="small"
            exclusive
            value={original ? "original" : "generated"}
            onChange={(_, value) => {
              if (value) setView(value);
            }}
          >
            <ToggleButton value="original">Original upload</ToggleButton>
            <ToggleButton value="generated">Generated PDF</ToggleButton>
          </ToggleButtonGroup>
        )}
        {canPreview && (
          <Paper
            component="iframe"
            title={original ? "Original uploaded resume" : "Generated resume PDF"}
            variant="panel"
            src={src}
            sx={{
              width: "100%",
              aspectRatio: "8.5/11",
              bgcolor: "background.default",
            }}
          />
        )}
        {!canPreview && (
          <Typography variant="body2Muted">
            {original
              ? "Open the original file to view its formatting. An inline preview is available for PDF uploads."
              : "Add resume content to generate a PDF."}
          </Typography>
        )}
        <Typography variant="captionMuted">
          {original
            ? "Your original file, unchanged by extraction or rewriting."
            : "Uses the OpenApply template with your most recently saved text. The original file’s layout is not reproduced."}
        </Typography>
      </Stack>
    </SectionCard>
  );
}
