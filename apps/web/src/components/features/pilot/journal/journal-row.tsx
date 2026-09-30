"use client";

import type { ReactElement } from "react";
import type { PilotJournalEntry, PilotJournalKind } from "@jobpilot/contracts/pilot";
import type { SvgIconComponent } from "@mui/icons-material";
import {
  Autorenew,
  Bolt,
  NotificationImportant,
  Rule,
  Summarize,
  Terminal,
  Visibility,
} from "@mui/icons-material";
import { Box, Chip, type ChipProps, Stack, Typography } from "@mui/material";
import { RelativeTime } from "@/components/ui/display";
import { humanizeIsoInText } from "@/utils/format";

export const KIND_META: Record<
  PilotJournalKind,
  { icon: SvgIconComponent; color: ChipProps["color"]; label: string }
> = {
  cycle: { icon: Autorenew, color: "primary", label: "Cycle" },
  action: { icon: Bolt, color: "info", label: "Action" },
  observation: { icon: Visibility, color: "default", label: "Note" },
  question: { icon: NotificationImportant, color: "warning", label: "Question" },
  system: { icon: Terminal, color: "default", label: "System" },
  digest: { icon: Summarize, color: "success", label: "Summary" },
  correction: { icon: Rule, color: "secondary", label: "Adjustment" },
};

export const KIND_ORDER = Object.keys(KIND_META) as PilotJournalKind[];

type JournalDetail = PilotJournalEntry["detail"];

function countOf(detail: JournalDetail, key: string): number {
  const value = detail[key];
  return typeof value === "number" ? value : 0;
}

interface DigestCountsProps {
  detail: JournalDetail;
}

function DigestCounts(props: DigestCountsProps): ReactElement {
  const { detail } = props;
  const parts = [
    `${countOf(detail, "applicationsCreated")} applied`,
    `${countOf(detail, "jobsFailed") + countOf(detail, "jobsSkipped")} not applied`,
    `${countOf(detail, "networkingSent")} networking (${countOf(detail, "networkingReplies")} replies)`,
    `${countOf(detail, "promotionsPosted")} posts`,
    `${countOf(detail, "openQuestions")} open`,
  ];
  return <Typography variant="captionMuted">{parts.join(" · ")}</Typography>;
}

interface JournalRowProps {
  entry: PilotJournalEntry;
}

export function JournalRow(props: JournalRowProps): ReactElement {
  const { entry } = props;
  const meta = KIND_META[entry.kind];
  const Icon = meta.icon;
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: "flex-start" }}>
      <Chip
        size="small"
        color={meta.color}
        icon={<Icon fontSize="sm" />}
        label={meta.label}
        sx={{ minWidth: 110 }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2">{humanizeIsoInText(entry.summary)}</Typography>
        {entry.kind === "digest" && <DigestCounts detail={entry.detail} />}
      </Box>
      <RelativeTime value={entry.createdAt} sx={{ whiteSpace: "nowrap" }} />
    </Stack>
  );
}
