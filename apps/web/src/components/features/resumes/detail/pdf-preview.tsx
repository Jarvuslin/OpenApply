"use client";

import { type ReactElement, useState } from "react";
import { OpenInNew } from "@mui/icons-material";
import { Button, Paper, Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { resumeSourceUrl } from "@/api/resume-urls";
import type { ResumeDto } from "@/api/types";
import { SectionCard } from "@/components/ui/layout";
import { ArtifactPreview } from "./artifact-preview";

interface ResumePdfPreviewProps {
  resume: ResumeDto;
}

export function ResumePdfPreview(props: ResumePdfPreviewProps): ReactElement {
  const { resume } = props;
  const [view, setView] = useState("original");
  const original = Boolean(resume.sourceFilename) && (view === "original" || !resume.content);
  const src = resumeSourceUrl(resume.id, resume.updatedAt);
  const canPreview = original
    ? resume.sourceMimeType === "application/pdf"
    : Boolean(resume.content);
  return (
    <SectionCard
      title={original ? "Original upload" : "Generated PDF"}
      actions={
        original && (
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
        )
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
        {!original && resume.content && (
          <ArtifactPreview
            key={`${resume.id}:${resume.updatedAt}`}
            resumeId={resume.id}
            updatedAt={resume.updatedAt}
          />
        )}
        {original && canPreview && (
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
            : "The preview and downloads use the same saved PDF revision. Later edits create a new revision; previous files stay unchanged."}
        </Typography>
      </Stack>
    </SectionCard>
  );
}
