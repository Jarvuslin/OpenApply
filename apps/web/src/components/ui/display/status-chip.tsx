"use client";

import type { ReactElement } from "react";
import type { ChipProps } from "@mui/material";
import type { ApplicationStatus } from "@openapply/contracts/application";
import { ColorChip } from "./color-chip";

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  applied: "Applied",
  screening: "Screening",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

const STATUS_COLOR: Record<ApplicationStatus, ChipProps["color"]> = {
  applied: "default",
  screening: "info",
  interviewing: "primary",
  offer: "success",
  rejected: "error",
  withdrawn: "default",
};

interface StatusChipProps {
  status: ApplicationStatus;
  size?: ChipProps["size"];
}

export function StatusChip(props: StatusChipProps): ReactElement {
  const { status, size } = props;
  return (
    <ColorChip value={status} colors={STATUS_COLOR} label={STATUS_LABEL[status]} size={size} />
  );
}
