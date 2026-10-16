"use client";

import { type ReactElement, type ReactNode, useId } from "react";
import { Bookmark, BookmarkBorder, Close, OpenInNew } from "@mui/icons-material";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  LinearProgress,
  Link,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { JOB_LEVEL_LABELS } from "@openapply/contracts/job-listing";
import { discoverQueries } from "@/api/discover-queries";
import { useApiQuery } from "@/api/hooks";
import { formatDate } from "@/utils/format";
import { AppliedAction } from "./applied-action";
import { jobSourceName } from "./job-attribution";

interface JobDetailProps {
  slug: string | null;
  onClose: () => void;
  saved: boolean;
  saving: boolean;
  onToggleSaved: () => void;
  applied: boolean;
  markingApplied: boolean;
  onMarkApplied: () => void;
  actionError: string;
  canUndoApplied: boolean;
  onUndoApplied: () => void;
}

interface DetailSectionProps {
  title: string;
  children: ReactNode;
}

function safeUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") return url.href;
  } catch {
    return undefined;
  }
  return undefined;
}

function DetailSection(props: DetailSectionProps): ReactElement {
  const { title, children } = props;
  return (
    <Stack spacing={1.5}>
      <Typography component="h3" variant="h5">
        {title}
      </Typography>
      {children}
    </Stack>
  );
}

function BulletList(props: { items: string[] }): ReactElement {
  const { items } = props;
  return (
    <Stack component="ul" spacing={1} sx={{ m: 0, pl: 2.5 }}>
      {[...new Set(items)].map((item) => (
        <Typography
          component="li"
          key={item}
          variant="body1Muted"
          sx={{ overflowWrap: "anywhere" }}
        >
          {item}
        </Typography>
      ))}
    </Stack>
  );
}

export function JobDetail(props: JobDetailProps): ReactElement {
  const {
    slug,
    onClose,
    saved,
    saving,
    onToggleSaved,
    applied,
    markingApplied,
    onMarkApplied,
    actionError,
    canUndoApplied,
    onUndoApplied,
  } = props;
  const titleId = useId();
  const query = useApiQuery(discoverQueries.detail(slug ?? ""), { enabled: slug !== null });
  const job = query.data;
  const employerUrl = safeUrl(job?.employerUrl);
  const initials = job?.company
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase();
  const workplace = job?.workMode ?? (job?.remote ? "remote" : null);
  const skills = [...new Set(job?.skills ?? [])];
  const sources = (job?.sources ?? []).flatMap((source) => {
    const url = safeUrl(source.url);
    return url ? [{ ...source, url }] : [];
  });

  return (
    <Drawer
      anchor="right"
      open={slug !== null}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: { width: 640, maxWidth: "100%" },
          role: "dialog",
          "aria-modal": true,
          "aria-labelledby": titleId,
        },
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", justifyContent: "space-between", px: 3, py: 2 }}
      >
        <Typography variant="overlineMuted">Job details</Typography>
        <Stack direction="row" spacing={0.5}>
          {job && (
            <Tooltip title={saved ? "Saved for later" : "Save for later"}>
              <IconButton
                aria-label={
                  saved ? `Remove ${job.title} from saved jobs` : `Save ${job.title} for later`
                }
                aria-pressed={saved}
                loading={saving}
                onClick={onToggleSaved}
                sx={{ color: saved ? "text.primary" : "text.secondary" }}
              >
                {saved ? <Bookmark /> : <BookmarkBorder />}
              </IconButton>
            </Tooltip>
          )}
          <IconButton aria-label="Close job details" onClick={onClose}>
            <Close />
          </IconButton>
        </Stack>
      </Stack>
      <Divider />
      {query.isLoading && <LinearProgress aria-label="Loading job details" />}
      <Stack spacing={3} sx={{ p: 3 }}>
        {actionError && (
          <Alert severity="error" role="alert">
            {actionError}
          </Alert>
        )}
        <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
          {job && (
            <Avatar
              src={safeUrl(job.companyLogoUrl)}
              alt=""
              variant="rounded"
              sx={{
                bgcolor: job.companyLogoUrl ? "common.white" : "surfaces.elevated",
                color: "text.primary",
                typography: "h4",
                "& .MuiAvatar-img": { objectFit: "contain", p: 0.5 },
              }}
            >
              {initials || "?"}
            </Avatar>
          )}
          <Stack spacing={1} sx={{ minWidth: 0 }}>
            <Typography id={titleId} component="h2" variant="h3" sx={{ overflowWrap: "anywhere" }}>
              {job?.title ?? "Job details"}
            </Typography>
            {job && (
              <Typography variant="body1Muted" sx={{ overflowWrap: "anywhere" }}>
                {job.company}
                {job.location && ` · ${job.location}`}
              </Typography>
            )}
          </Stack>
        </Stack>
        {query.error && (
          <Alert
            severity="error"
            action={<Button onClick={() => void query.refetch()}>Retry</Button>}
          >
            Could not load this job. Try again to see its details.
          </Alert>
        )}
        {job && (
          <>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
              <AppliedAction
                title={job.title}
                company={job.company}
                applied={applied}
                pending={markingApplied}
                canUndo={canUndoApplied}
                onMark={onMarkApplied}
                onUndo={onUndoApplied}
              />
              <Typography variant="captionMuted">
                {applied
                  ? "This job is excluded from saved-job application batches."
                  : "Already submitted an application? Keep your list up to date."}
              </Typography>
            </Stack>
            <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
              {job.level !== "unknown" && <Chip size="small" label={JOB_LEVEL_LABELS[job.level]} />}
              {workplace && (
                <Chip size="small" label={workplace} sx={{ textTransform: "capitalize" }} />
              )}
              {(job.employmentKind || job.employmentType) && (
                <Chip
                  size="small"
                  label={job.employmentKind?.replaceAll("_", " ") ?? job.employmentType}
                  sx={{ textTransform: "capitalize" }}
                />
              )}
              {job.yearsExperience !== null && (
                <Chip size="small" label={`${job.yearsExperience}+ years`} />
              )}
            </Stack>
            <Stack spacing={0.75}>
              <Typography variant="body1Strong">{job.salary || "Salary not listed"}</Typography>
              <Typography variant="captionMuted">
                {job.postedAt ? `Posted ${formatDate(job.postedAt)}` : "Posting date unavailable"}
              </Typography>
            </Stack>
            {employerUrl && (
              <Button
                component="a"
                href={employerUrl}
                target="_blank"
                rel="noopener noreferrer"
                variant="contained"
                endIcon={<OpenInNew />}
              >
                Open company career page
              </Button>
            )}
            <Divider />
            <DetailSection title="About the role">
              <Typography
                variant="body1Muted"
                sx={{ whiteSpace: "pre-line", overflowWrap: "anywhere" }}
              >
                {job.descriptionExcerpt ||
                  "This listing has no description preview. Visit the original posting for full details."}
              </Typography>
            </DetailSection>
            {job.responsibilities.length > 0 && (
              <DetailSection title="What you'll do">
                <BulletList items={job.responsibilities} />
              </DetailSection>
            )}
            {job.requirements.length > 0 && (
              <DetailSection title="Requirements">
                <BulletList items={job.requirements} />
              </DetailSection>
            )}
            {skills.length > 0 && (
              <DetailSection title="Skills">
                <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
                  {skills.map((skill) => (
                    <Chip key={skill} label={skill} size="small" />
                  ))}
                </Stack>
              </DetailSection>
            )}
            {sources.length > 0 && (
              <>
                <Divider />
                <DetailSection title="Original postings">
                  <Stack component="ul" spacing={1.5} sx={{ listStyle: "none", p: 0, m: 0 }}>
                    {sources.map((source) => (
                      <Box component="li" key={source.url}>
                        <Link
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          sx={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 0.75,
                            overflowWrap: "anywhere",
                          }}
                        >
                          {source.board
                            ? jobSourceName(source.board)
                            : new URL(source.url).hostname}
                          <OpenInNew fontSize="inherit" />
                        </Link>
                      </Box>
                    ))}
                  </Stack>
                </DetailSection>
              </>
            )}
          </>
        )}
      </Stack>
    </Drawer>
  );
}
