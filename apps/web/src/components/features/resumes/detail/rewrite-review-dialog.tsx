"use client";

import type { ReactElement } from "react";
import { ExpandMore, OpenInNew } from "@mui/icons-material";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Button,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { EMPTY_RESUME_DATA } from "@openapply/contracts/resume";
import { resumePdfUrl, resumeSourceUrl, variantPdfUrl } from "@/api/resume-urls";
import type { ResumeDto, ResumeVariantDto } from "@/api/types";
import { FormDialogShell } from "@/components/ui/form";
import { diffRewrite } from "./rewrite-diff";

interface RewriteReviewDialogProps {
  open: boolean;
  onClose: () => void;
  resume: ResumeDto;
  suggestion: ResumeVariantDto;
  isLoading: boolean;
  onApply: () => void;
}

/** Before and after for every changed field, so applying a rewrite is not a leap of faith. */
export function RewriteReviewDialog(props: RewriteReviewDialogProps): ReactElement {
  const { open, onClose, resume, suggestion, isLoading, onApply } = props;
  const changes = diffRewrite(resume.content ?? EMPTY_RESUME_DATA, suggestion.content);
  const notes = suggestion.diffNotes?.trim();

  return (
    <FormDialogShell
      open={open}
      onClose={onClose}
      title="Suggested rewrite"
      maxWidth="md"
      onSubmit={onApply}
      submit={
        <Button type="submit" variant="contained" disabled={isLoading}>
          Apply rewrite
        </Button>
      }
    >
      <Stack spacing={2}>
        <Typography variant="body2Muted">
          Your original upload stays unchanged. Generated PDFs use the OpenApply template, so their
          fonts, section order and spacing can differ from the original even before a rewrite.
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          {resume.sourceFilename && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<OpenInNew fontSize="sm" />}
              component="a"
              href={resumeSourceUrl(resume.id, resume.updatedAt)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Original upload
            </Button>
          )}
          <Button
            size="small"
            variant="outlined"
            startIcon={<OpenInNew fontSize="sm" />}
            component="a"
            href={resumePdfUrl(resume.id, resume.updatedAt)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Current generated PDF
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<OpenInNew fontSize="sm" />}
            component="a"
            href={variantPdfUrl(suggestion.id, suggestion.updatedAt)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Rewritten PDF
          </Button>
        </Stack>

        {notes && (
          <Accordion>
            <AccordionSummary expandIcon={<ExpandMore />}>
              <Typography variant="body2Strong">
                Agent's explanation · {changes.length} changed fields
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Typography variant="body2Muted" sx={{ whiteSpace: "pre-line" }}>
                {notes}
              </Typography>
            </AccordionDetails>
          </Accordion>
        )}

        {changes.length === 0 ? (
          <Typography variant="body2Muted">
            The rewrite matches your current text field for field. Discard it, or open both PDFs to
            compare the layout.
          </Typography>
        ) : (
          <Stack spacing={1.5} divider={<Divider />}>
            {changes.map((change) => (
              <Stack key={change.where} spacing={1}>
                <Typography variant="body2Strong">{change.where}</Typography>
                <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
                  <Paper variant="panel" sx={{ p: 1.5, flex: 1, minWidth: 0 }}>
                    <Typography variant="captionMuted">Original</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {change.before || "(empty)"}
                    </Typography>
                  </Paper>
                  <Paper
                    variant="panel"
                    sx={{ p: 1.5, borderColor: "primary.main", flex: 1, minWidth: 0 }}
                  >
                    <Typography variant="captionMuted">Suggested</Typography>
                    <Typography variant="body2">{change.after || "(empty)"}</Typography>
                  </Paper>
                </Stack>
              </Stack>
            ))}
          </Stack>
        )}
      </Stack>
    </FormDialogShell>
  );
}
