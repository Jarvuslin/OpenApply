"use client";

import type { ReactElement } from "react";
import { Box, Button, DialogActions, DialogContent, Typography } from "@mui/material";
import { SUBMISSION_SCREENSHOT_DAYS } from "@openapply/contracts/work-queue";
import { API_BASE_URL } from "@/api/base-url";
import { Dialog, DialogTitle } from "@/components/ui/feedback";

interface SubmissionScreenshotProps {
  workItemId: string;
  title: string;
  hasScreenshot: boolean;
  open: boolean;
  onClose: () => void;
}

export function SubmissionScreenshot({
  workItemId,
  title,
  hasScreenshot,
  open,
  onClose,
}: SubmissionScreenshotProps): ReactElement {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Submitted: {title}</DialogTitle>
      <DialogContent>
        {hasScreenshot ? (
          <Box
            component="img"
            src={`${API_BASE_URL}/api/work-queue/${encodeURIComponent(workItemId)}/screenshot`}
            alt={`Confirmation page after submitting ${title}`}
            sx={{ width: 1, border: 1, borderColor: "divider", borderRadius: 1 }}
          />
        ) : (
          <Typography color="text.secondary">
            No screenshot. Screenshots are deleted after {SUBMISSION_SCREENSHOT_DAYS} days, and the
            agent skips it when the site shows no confirmation page.
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
