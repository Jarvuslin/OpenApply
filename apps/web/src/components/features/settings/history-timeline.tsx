"use client";

import { type ReactElement, type ReactNode, useState } from "react";
import { Box, Card, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import { Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/feedback";
import { EditButton } from "./profile-card";

interface TimelineEntry {
  key: string;
  dates: string;
  duration: string | null;
  title: string;
  subtitle: string;
  body?: string;
  /** Facts shown beside the title, such as GPA and transcript. */
  aside?: ReactNode;
}

interface HistoryTimelineProps {
  entries: TimelineEntry[];
  /** "job" or "school", used in the delete confirmation. */
  noun: string;
  empty: ReactNode;
  onEdit: (index: number) => void;
  onDelete: (index: number) => Promise<void>;
}

const RAIL = 24;

/** Entries as cards on a vertical line, each with its own Edit and Delete. */
export function HistoryTimeline(props: HistoryTimelineProps): ReactElement {
  const { entries, noun, empty, onEdit, onDelete } = props;
  const [deleting, setDeleting] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  if (entries.length === 0) return <Box>{empty}</Box>;
  const target = deleting === null ? null : entries[deleting];
  return (
    <Box component="ol" sx={{ listStyle: "none", m: 0, p: 0, position: "relative" }}>
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          left: RAIL / 2 - 1,
          top: 24,
          bottom: 24,
          width: 2,
          bgcolor: "divider",
          display: entries.length > 1 ? "block" : "none",
        }}
      />
      {entries.map((entry, index) => (
        <Stack
          component="li"
          key={entry.key}
          direction="row"
          spacing={1.5}
          sx={{ position: "relative", "& + &": { mt: 1.5 } }}
        >
          <Box
            sx={{ width: RAIL, flexShrink: 0, display: "flex", justifyContent: "center", pt: 2.75 }}
          >
            <Box
              aria-hidden
              sx={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                bgcolor: "text.disabled",
                boxShadow: (t) => `0 0 0 3px ${t.palette.background.paper}`,
                zIndex: 1,
              }}
            />
          </Box>
          <Card sx={{ flex: 1, minWidth: 0 }}>
            <Stack
              direction={{ xs: "column", md: "row" }}
              spacing={{ xs: 1, md: 2.5 }}
              sx={{ p: 2 }}
            >
              <Box sx={{ width: { md: 150 }, flexShrink: 0 }}>
                <Typography variant="body2Strong" component="p">
                  {entry.dates || "Dates not set"}
                </Typography>
                {entry.duration && (
                  <Typography variant="captionMuted" component="p">
                    {entry.duration}
                  </Typography>
                )}
              </Box>
              <Stack spacing={0.25} sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body1Strong" component="h3" sx={{ overflowWrap: "anywhere" }}>
                  {entry.title}
                </Typography>
                {entry.subtitle && (
                  <Typography variant="body2Muted" sx={{ overflowWrap: "anywhere" }}>
                    {entry.subtitle}
                  </Typography>
                )}
                {entry.body && (
                  <Typography
                    variant="body2"
                    sx={{
                      pt: 1,
                      lineHeight: 1.65,
                      whiteSpace: "pre-line",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {entry.body}
                  </Typography>
                )}
              </Stack>
              {entry.aside}
              <Stack
                direction="row"
                spacing={0.75}
                sx={{ alignItems: "flex-start", flexShrink: 0 }}
              >
                <EditButton onClick={() => onEdit(index)} />
                <Tooltip title={`Delete this ${noun}`}>
                  <IconButton
                    size="small"
                    aria-label={`Delete ${entry.title}`}
                    onClick={() => setDeleting(index)}
                    sx={{
                      width: 32,
                      height: 32,
                      border: 1,
                      borderColor: "divider",
                      borderRadius: (t) => t.radii.sm,
                    }}
                  >
                    <Trash2 size={14} aria-hidden />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Stack>
          </Card>
        </Stack>
      ))}
      <ConfirmDialog
        open={target !== null && !busy}
        title={`Delete this ${noun}?`}
        description={`${target?.title ?? ""} will be removed from your profile. This can't be undone.`}
        confirmLabel="Delete"
        destructive
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting === null) return;
          setBusy(true);
          void onDelete(deleting)
            .catch(() => undefined)
            .finally(() => {
              setBusy(false);
              setDeleting(null);
            });
        }}
      />
    </Box>
  );
}
