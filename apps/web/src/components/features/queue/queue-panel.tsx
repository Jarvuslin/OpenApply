"use client";

import { type ReactElement, type ReactNode, useState } from "react";
import {
  Alert,
  Box,
  Button,
  IconButton,
  LinearProgress,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import { X } from "lucide-react";
import { useApiQuery } from "@/api/hooks";
import { type QueueItemDto, queueQueries } from "@/api/queue-queries";
import { QuestionCard } from "@/components/features/questions/question-card";
import { useOpenQuestions } from "@/components/features/questions/use-open-questions";
import { ExternalLink } from "@/components/ui/display";
import { useQueueCompanion } from "@/hooks/use-queue-companion";
import { ActivityTimeline } from "./activity-timeline";
import { DetailRow } from "./detail-row";
import { QueueBrowser } from "./queue-browser";
import { canPause, canRetry, canStop, isWorking } from "./queue-state";
import { FitMeter, QueueStatus } from "./queue-status";
import { QueueSteps } from "./queue-steps";
import { SubmissionScreenshot } from "./submission-screenshot";
import { useQueueControls } from "./use-queue-controls";

interface QueuePanelProps {
  id: string;
  /** Open with the activity log already expanded. */
  activity: boolean;
  onClose: () => void;
}

export function QueuePanel({ id, activity, onClose }: QueuePanelProps): ReactElement {
  const detail = useApiQuery(queueQueries.detail(id), { refetchInterval: 5_000 });
  const item = detail.data?.item;
  return (
    <Stack sx={{ height: 1, minHeight: 0 }} aria-label="Job details" component="aside">
      {detail.isLoading && <LinearProgress aria-label="Loading this job" />}
      {detail.error && (
        <Stack spacing={2} sx={{ p: 2.5 }}>
          <Alert severity="error">This job is no longer in your queue.</Alert>
          <Button onClick={onClose} sx={{ alignSelf: "flex-start" }}>
            Close
          </Button>
        </Stack>
      )}
      {item && <PanelContent key={item.id} item={item} activity={activity} onClose={onClose} />}
    </Stack>
  );
}

interface PanelContentProps {
  item: QueueItemDto;
  activity: boolean;
  onClose: () => void;
}

function PanelContent({ item, activity, onClose }: PanelContentProps): ReactElement {
  const [showActivity, setShowActivity] = useState(activity);
  const [viewingScreenshot, setViewingScreenshot] = useState(false);
  const { status, accountId } = useQueueCompanion();
  const { questions } = useOpenQuestions();
  const controls = useQueueControls(item);
  const worker = status?.workers.find(
    (row) => row.workItemId === item.id && row.state === "running",
  );
  const asked = questions.filter(
    (question) =>
      question.subjectId === item.id ||
      (question.subjectType === "job" && !!item.jobId && question.subjectId === item.jobId),
  );
  const heading = item.company ? `${item.title} · ${item.company}` : item.title;
  const posting = item.url ? URL.parse(item.url) : null;

  return (
    <>
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: "flex-start", px: 2.5, py: 2, borderBottom: 1, borderColor: "divider" }}
      >
        <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
          <QueueStatus state={item.state} />
          <Typography variant="h4" component="h2">
            {heading}
          </Typography>
        </Stack>
        <IconButton size="small" aria-label="Close details" onClick={onClose}>
          <X size={16} strokeWidth={1.75} aria-hidden />
        </IconButton>
      </Stack>

      <Stack spacing={2.5} sx={{ flex: 1, minHeight: 0, overflowY: "auto", p: 2.5 }}>
        {item.state === "needs_user" && (
          <Stack spacing={2}>
            <Typography variant="body2Muted">
              We paused this application at its last question. Answer it here and we continue right
              away. The rest of the queue keeps going.
            </Typography>
            {asked.map((question) => (
              <QuestionCard key={question.id} question={question} />
            ))}
            {asked.length === 0 && (
              <Alert severity="info">
                {item.reason ?? "This job is waiting on you."}{" "}
                <Link href="/needs-you">Open Needs you</Link>
              </Alert>
            )}
          </Stack>
        )}

        {isWorking(item.state) && worker && (
          <QueueBrowser
            key={`${accountId}:${worker.workItemId}:${worker.executionId}:${worker.browserSessionId}`}
            worker={worker}
            url={item.url}
            accountSetup={item.intent === "account_setup"}
          />
        )}
        {isWorking(item.state) && !worker && (
          <Typography variant="body2Muted">
            The live view appears here while your computer is connected and working on this job.
          </Typography>
        )}

        {item.reason && ["failed", "skipped", "cancelled"].includes(item.state) && (
          <Alert severity={item.state === "failed" ? "error" : "info"}>{item.reason}</Alert>
        )}

        {item.kind === "application" && (
          <Section title="Steps">
            <QueueSteps state={item.state} started={!!item.startedAt} />
          </Section>
        )}

        <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2, overflow: "hidden" }}>
          <DetailRow label="Fit">
            <FitMeter score={item.matchScore} />
          </DetailRow>
          <DetailRow label="Resume">
            <Typography variant="body2" noWrap>
              {item.resumeLabel ?? "Not picked yet"}
            </Typography>
          </DetailRow>
          {posting && item.url && (
            <DetailRow label="Posting">
              <ExternalLink href={item.url}>{posting.hostname.replace(/^www\./, "")}</ExternalLink>
            </DetailRow>
          )}
          {item.applicationId && (
            <DetailRow label="Application">
              <Link href={`/applications/${encodeURIComponent(item.applicationId)}`}>
                Open record
              </Link>
            </DetailRow>
          )}
        </Box>

        <Stack spacing={1}>
          <Button
            size="small"
            onClick={() => setShowActivity((open) => !open)}
            sx={{ alignSelf: "flex-start" }}
          >
            {showActivity ? "Hide activity" : "Show activity"}
          </Button>
          {showActivity && <ActivityTimeline workItemId={item.id} />}
        </Stack>

        {controls.error && <Alert severity="error">{controls.error.message}</Alert>}
      </Stack>

      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", px: 2.5, py: 2, borderTop: 1, borderColor: "divider" }}
      >
        <PanelActions
          item={item}
          controls={controls}
          onSeeConfirmation={() => setViewingScreenshot(true)}
        />
      </Stack>
      {item.state === "submitted" && (
        <SubmissionScreenshot
          workItemId={item.id}
          title={item.title}
          hasScreenshot={item.hasScreenshot}
          open={viewingScreenshot}
          onClose={() => setViewingScreenshot(false)}
        />
      )}
    </>
  );
}

interface SectionProps {
  title: string;
  children: ReactNode;
}

function Section({ title, children }: SectionProps): ReactElement {
  return (
    <Stack spacing={1.5}>
      <Typography variant="captionMuted">{title}</Typography>
      {children}
    </Stack>
  );
}

interface PanelActionsProps {
  item: QueueItemDto;
  controls: ReturnType<typeof useQueueControls>;
  onSeeConfirmation: () => void;
}

function PanelActions({ item, controls, onSeeConfirmation }: PanelActionsProps): ReactElement {
  const { busy } = controls;
  let hint = "";
  if (isWorking(item.state)) hint = "The agent finishes its current step first.";
  if (item.state === "needs_user") hint = "The rest of the queue keeps going.";
  return (
    <>
      {item.state === "needs_user" && (
        <Button variant="outlined" disabled={busy} onClick={() => void controls.stop()}>
          Skip this job
        </Button>
      )}
      {canPause(item.state) && (
        <Button
          variant="outlined"
          disabled={busy || !!item.pauseRequestedAt}
          onClick={controls.pause}
        >
          Pause
        </Button>
      )}
      {item.state !== "needs_user" && canStop(item.state) && (
        <Button color="error" disabled={busy} onClick={() => void controls.stop()}>
          Stop
        </Button>
      )}
      {(item.state === "paused" ||
        (item.state !== "needs_user" && canRetry(item.state, item.intent))) && (
        <Button variant="outlined" disabled={busy} onClick={controls.resume}>
          {item.state === "paused" ? "Resume" : "Retry"}
        </Button>
      )}
      {item.state === "submitted" && (
        <Button variant="outlined" onClick={onSeeConfirmation}>
          See confirmation
        </Button>
      )}
      {!isWorking(item.state) && item.state !== "stopping" && (
        <Button color="error" disabled={busy} onClick={() => void controls.remove()}>
          Remove
        </Button>
      )}
      <Typography variant="captionMuted" sx={{ flex: 1, textAlign: "right" }}>
        {hint}
      </Typography>
    </>
  );
}
