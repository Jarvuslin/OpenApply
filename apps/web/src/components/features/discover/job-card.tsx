"use client";

import type { ReactElement } from "react";
import { Bookmark, BookmarkBorder, OpenInNew } from "@mui/icons-material";
import {
  Avatar,
  Box,
  Button,
  Card,
  CardActionArea,
  IconButton,
  Link,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { JOB_LEVEL_LABELS } from "@openapply/contracts/job-listing";
import { AppliedAction } from "./applied-action";
import { JobAttribution } from "./job-attribution";
import type { DiscoverJobCardData } from "./job-board-types";

interface JobCardProps {
  job: DiscoverJobCardData;
  saved: boolean;
  saving?: boolean;
  onToggleSaved: () => void;
  onOpenDetails: () => void;
  applied: boolean;
  markingApplied?: boolean;
  onMarkApplied: () => void;
  canUndoApplied: boolean;
  onUndoApplied: () => void;
  queueing?: boolean;
  /** Omitted on public pages, where nothing can be queued. */
  onAddToQueue?: () => void;
}

const WORK_MODE_LABELS: Record<string, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "Onsite",
};

const EMPLOYMENT_LABELS: Record<string, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  internship: "Internship",
  temporary: "Temporary",
};

function postedDate(value: string | null | undefined): string {
  if (!value) return "Posting date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Posting date unavailable";
  return `Posted ${date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })}`;
}

export function JobCard(props: JobCardProps): ReactElement {
  const {
    job,
    saved,
    saving = false,
    onToggleSaved,
    onOpenDetails,
    applied,
    markingApplied = false,
    onMarkApplied,
    canUndoApplied,
    onUndoApplied,
    queueing = false,
    onAddToQueue,
  } = props;
  const initials = job.company
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase();
  const location = [
    job.company,
    job.location || "Location not listed",
    job.workMode ? (WORK_MODE_LABELS[job.workMode] ?? job.workMode) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const metadata = [
    job.employmentType ? (EMPLOYMENT_LABELS[job.employmentType] ?? job.employmentType) : "",
    job.level && job.level !== "unknown" ? JOB_LEVEL_LABELS[job.level] : "",
    postedDate(job.postedAt),
  ].filter(Boolean);
  const saveLabel = saved ? `Remove ${job.title} from saved jobs` : `Save ${job.title} for later`;

  return (
    <Card
      component="article"
      sx={{
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        "&:hover": { borderColor: "line.borderHi" },
      }}
    >
      <CardActionArea
        onClick={onOpenDetails}
        aria-label={`View ${job.title} at ${job.company}`}
        sx={{ display: "flex", alignItems: "stretch", p: 2.5, pb: 1.5 }}
      >
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "flex-start", width: "100%" }}>
          <Avatar
            src={job.companyLogoUrl || undefined}
            alt=""
            variant="rounded"
            sx={{
              width: (theme) => theme.spacing(4),
              height: (theme) => theme.spacing(4),
              borderRadius: (theme) => theme.radii.sm,
              bgcolor: job.companyLogoUrl ? "surfaces.card" : "surfaces.elevated",
              color: "text.secondary",
              typography: "body2",
              border: 1,
              borderColor: "divider",
              flexShrink: 0,
              "& .MuiAvatar-img": { objectFit: "contain", p: 0.5 },
            }}
          >
            {initials || "?"}
          </Avatar>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              component="h3"
              variant="h4"
              sx={{
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                overflowWrap: "anywhere",
              }}
            >
              {job.title}
            </Typography>
            <Typography variant="body2Muted" sx={{ mt: 0.5, overflowWrap: "anywhere" }}>
              {location}
            </Typography>
            <Stack
              direction="row"
              spacing={1}
              sx={{ flexWrap: "wrap", alignItems: "center", mt: 0.75 }}
            >
              <Typography variant="monoData" color="text.secondary">
                {job.salaryText || "Salary not listed"}
              </Typography>
              <Typography variant="captionMuted">{metadata.join(" · ")}</Typography>
            </Stack>
          </Box>
          <Typography
            variant="body2Muted"
            sx={{
              display: { xs: "none", xl: "-webkit-box" },
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              overflowWrap: "anywhere",
              flex: 0.65,
              minWidth: 0,
              alignSelf: "center",
            }}
          >
            {job.description || "Open this listing to read the role and its requirements."}
          </Typography>
        </Stack>
      </CardActionArea>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        sx={{
          alignItems: { xs: "stretch", sm: "center" },
          justifyContent: "space-between",
          gap: 1.5,
          px: 2.5,
          pb: 2.5,
        }}
      >
        <Stack
          direction="row"
          spacing={1}
          sx={{ minWidth: 0, flexWrap: "wrap", alignItems: "center" }}
        >
          <JobAttribution links={job.attributionLinks ?? []} />
          {job.careerUrl && (
            <Link
              href={job.careerUrl}
              target="_blank"
              rel="noopener noreferrer"
              variant="caption"
              aria-label={`Open career page for ${job.title} at ${job.company} (new tab)`}
              sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, width: "fit-content" }}
            >
              Career page <OpenInNew fontSize="inherit" />
            </Link>
          )}
        </Stack>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", flexWrap: "wrap", flexShrink: 0 }}
        >
          <Tooltip title={saved ? "Saved for later" : "Save for later"}>
            <IconButton
              size="small"
              aria-label={saveLabel}
              aria-pressed={saved}
              loading={saving}
              onClick={onToggleSaved}
              sx={{ color: saved ? "text.primary" : "text.secondary" }}
            >
              {saved ? <Bookmark fontSize="md" /> : <BookmarkBorder fontSize="md" />}
            </IconButton>
          </Tooltip>
          <AppliedAction
            title={job.title}
            company={job.company}
            applied={applied}
            pending={markingApplied}
            canUndo={canUndoApplied}
            onMark={onMarkApplied}
            onUndo={onUndoApplied}
          />
          {onAddToQueue && (
            <Button variant="contained" size="small" loading={queueing} onClick={onAddToQueue}>
              Add to queue
            </Button>
          )}
          <Button variant="outlined" size="small" onClick={onOpenDetails}>
            View details
          </Button>
        </Stack>
      </Stack>
    </Card>
  );
}
