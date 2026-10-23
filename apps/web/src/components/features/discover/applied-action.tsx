"use client";

import type { ReactElement } from "react";
import { CheckCircleOutlined } from "@mui/icons-material";
import { Button, Chip, Tooltip } from "@mui/material";

interface AppliedActionProps {
  title: string;
  company: string;
  applied: boolean;
  pending: boolean;
  canUndo: boolean;
  onMark: () => void;
  onUndo: () => void;
}

export function AppliedAction(props: AppliedActionProps): ReactElement {
  const { title, company, applied, pending, canUndo, onMark, onUndo } = props;

  if (applied) {
    return (
      <Tooltip
        title={
          canUndo ? "Click to mark as not applied" : "Submission recorded in your applications"
        }
      >
        <Chip
          color="success"
          size="small"
          icon={<CheckCircleOutlined />}
          label="Applied"
          disabled={pending}
          onClick={canUndo ? onUndo : undefined}
          aria-pressed={canUndo ? true : undefined}
          aria-label={
            canUndo
              ? `Mark ${title} at ${company} as not applied`
              : `Applied to ${title} at ${company}`
          }
        />
      </Tooltip>
    );
  }

  return (
    <Button
      size="small"
      startIcon={<CheckCircleOutlined />}
      loading={pending}
      onClick={onMark}
      aria-pressed={false}
      aria-label={`Mark ${title} at ${company} as applied`}
    >
      Mark applied
    </Button>
  );
}
