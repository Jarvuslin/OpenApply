"use client";

import type { ReactElement } from "react";
import {
  AssignmentTurnedInOutlined,
  CheckCircleOutlined,
  ErrorOutlined,
  HelpOutlined,
  HourglassEmptyOutlined,
  InsightsOutlined,
  LaunchOutlined,
  PlaylistAddOutlined,
  QuestionAnswerOutlined,
  SearchOutlined,
  SendOutlined,
  StopCircleOutlined,
} from "@mui/icons-material";
import { Alert, Box, Button, Chip, LinearProgress, Stack, Typography } from "@mui/material";
import type { WORK_TIMELINE_KINDS } from "@openapply/contracts/work-queue";
import { useApiQuery } from "@/api/hooks";
import { queueQueries } from "@/api/queue-queries";

type Kind = (typeof WORK_TIMELINE_KINDS)[number];

const ICONS: Record<Kind, ReactElement> = {
  found: <SearchOutlined fontSize="small" />,
  scored: <InsightsOutlined fontSize="small" />,
  queued: <PlaylistAddOutlined fontSize="small" />,
  started: <LaunchOutlined fontSize="small" />,
  stopped: <StopCircleOutlined fontSize="small" />,
  asked: <HelpOutlined fontSize="small" />,
  answered: <QuestionAnswerOutlined fontSize="small" />,
  reviewed: <AssignmentTurnedInOutlined fontSize="small" />,
  submitting: <SendOutlined fontSize="small" />,
  confirmed: <CheckCircleOutlined fontSize="small" />,
  waiting: <HourglassEmptyOutlined fontSize="small" />,
  failed: <ErrorOutlined fontSize="small" />,
};

const ICON_COLOR: Partial<Record<Kind, string>> = {
  confirmed: "success.main",
  failed: "error.main",
  stopped: "warning.main",
  waiting: "warning.main",
};

function when(at: Date | null): string {
  if (!at) return "";
  const date = new Date(at);
  const today = new Date().toDateString() === date.toDateString();
  return date.toLocaleString(
    undefined,
    today
      ? { hour: "2-digit", minute: "2-digit" }
      : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
  );
}

interface ActivityTimelineProps {
  workItemId: string;
}

/** What the agent did for one application, with why each run stopped. */
export function ActivityTimeline({ workItemId }: ActivityTimelineProps): ReactElement {
  const timeline = useApiQuery(queueQueries.timeline(workItemId), { refetchInterval: 15_000 });
  if (timeline.isPending) return <LinearProgress aria-label="Loading activity" />;
  if (!timeline.data)
    return (
      <Alert
        severity="error"
        action={<Button onClick={() => void timeline.refetch()}>Retry</Button>}
      >
        Could not load this activity.
      </Alert>
    );
  const { entries } = timeline.data;
  return (
    <Box component="ol" sx={{ listStyle: "none", m: 0, p: 0 }} aria-label="Activity">
      {entries.map((entry, index) => (
        <Stack
          component="li"
          key={`${entry.kind}-${entry.at ? new Date(entry.at).getTime() : ""}-${entry.title}`}
          direction="row"
          spacing={2}
          sx={{ alignItems: "stretch" }}
        >
          <Typography
            variant="body2Strong"
            sx={{ width: 96, flexShrink: 0, pt: 1, color: "success.dark", textAlign: "right" }}
          >
            {when(entry.at)}
          </Typography>
          <Stack sx={{ alignItems: "center", flexShrink: 0 }}>
            <Box
              sx={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                bgcolor: "background.paper",
                boxShadow: 1,
                color: ICON_COLOR[entry.kind] ?? "text.secondary",
              }}
            >
              {ICONS[entry.kind]}
            </Box>
            {index < entries.length - 1 && (
              <Box sx={{ flex: 1, width: 2, bgcolor: "success.light", minHeight: 16 }} />
            )}
          </Stack>
          <Stack
            direction="row"
            spacing={1}
            sx={{ flex: 1, minWidth: 0, pb: 2, pt: 0.75, alignItems: "flex-start" }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2">{entry.title}</Typography>
              {entry.detail && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block", overflowWrap: "anywhere" }}
                >
                  {entry.detail}
                </Typography>
              )}
            </Box>
            <Chip
              size="small"
              label={entry.automated ? "Auto" : "You"}
              color={entry.automated ? "success" : "default"}
              variant="outlined"
            />
          </Stack>
        </Stack>
      ))}
    </Box>
  );
}
