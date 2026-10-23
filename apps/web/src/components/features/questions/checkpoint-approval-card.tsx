"use client";

import { type ReactElement, useId, useState } from "react";
import { Alert, Button, Checkbox, FormControlLabel, Typography } from "@mui/material";
import { checkpointDecisionSchema } from "@openapply/contracts/checkpoint-approval";
import type { PilotQuestion } from "@openapply/contracts/pilot";
import { useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { api } from "@/api/client";
import { ApiError } from "@/api/error";
import { useApiQuery } from "@/api/hooks";
import { campaignQueries } from "@/api/queries";
import { invalidations, queryKeys } from "@/api/query-keys";
import { useSession } from "@/hooks/use-auth";
import { queueRequests, sendQueueRequest } from "@/lib/queue-request";
import { QuestionCardFrame, QuestionHeading } from "./question-card-frame";
import { SubmissionAttemptDetails } from "./submission-attempt-details";

interface CheckpointApprovalCardProps {
  question: PilotQuestion;
  approval: NonNullable<PilotQuestion["approval"]>;
}

export function CheckpointApprovalCard(props: CheckpointApprovalCardProps): ReactElement {
  const { question, approval } = props;
  const { user } = useSession();
  const client = useQueryClient();
  const evidence = useApiQuery(
    campaignQueries.submissionAttempt(approval.job.campaignId, approval.job.key),
    { retry: false },
  );
  const attempt = evidence.data?.attempt;
  const evidenceMatches =
    !evidence.error &&
    !evidence.isFetching &&
    attempt?.state === "prepared" &&
    !!attempt.checkpoint &&
    attempt.checkpointId === approval.checkpointId;
  const [reviewed, setReviewed] = useState(false);
  const [pending, setPending] = useState<"approve" | "skip" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [complete, setComplete] = useState(false);
  const expired = new Date(approval.expiresAt).getTime() <= Date.now();
  const closed =
    question.status !== "open" || !!approval.decision || !!approval.consumedAt || complete;
  async function reload(): Promise<void> {
    for (const queryKey of [
      ...invalidations.questions,
      queryKeys.queue.all,
      queryKeys.jobIntakes.all,
    ])
      await client.invalidateQueries({ queryKey });
    await evidence.refetch();
  }
  async function decide(decision: "approve" | "skip"): Promise<void> {
    if (busy || stale || expired || closed || (pending && pending !== decision)) return;
    if (decision === "approve" && (!reviewed || !evidenceMatches)) return;
    setBusy(true);
    setError("");
    setPending(decision);
    try {
      const input = {
        checkpointId: approval.checkpointId,
        checkpointHash: approval.checkpointHash,
        decision,
      };
      await sendQueueRequest(
        queueRequests,
        user?.id ?? "",
        ["checkpoint-decision", question.id, input],
        async (requestId) => {
          const result = await api.pilot
            .questions({ id: question.id })
            .decision.post(checkpointDecisionSchema.parse({ ...input, requestId }));
          if (result.error) throw new ApiError(result.error);
          return result.data;
        },
      );
      setComplete(true);
      setPending(null);
      await reload();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        setStale(true);
        setPending(null);
        setReviewed(false);
        setError(
          "This approval changed or expired. Reload the request and review the current application.",
        );
      } else
        setError(
          "The decision was not acknowledged. Retry the same decision or reload the request to inspect its state.",
        );
    } finally {
      setBusy(false);
    }
  }
  async function reloadRequest(): Promise<void> {
    setBusy(true);
    try {
      await reload();
      setStale(false);
      setPending(null);
      setReviewed(false);
      setError("");
    } catch {
      setError("Could not reload the current approval request.");
    } finally {
      setBusy(false);
    }
  }
  const promptId = useId();
  return (
    <QuestionCardFrame
      aria-labelledby={promptId}
      data-checkpoint-approval-id={question.id}
      icon={<Send size={22} aria-hidden />}
      subject={`${approval.job.title} · ${approval.job.company}`}
      time={question.createdAt}
      menu={[
        {
          kind: "item",
          key: "reload",
          label: "Reload approval request",
          disabled: busy,
          onClick: () => void reloadRequest(),
        },
      ]}
      footer={
        !closed && (
          <>
            <Button
              variant="outlined"
              disabled={busy || stale || expired || (!!pending && pending !== "skip")}
              onClick={() => void decide("skip")}
              sx={{ minHeight: 44, px: 2.5, mr: 1 }}
            >
              {pending === "skip" ? "Retry same skip" : "Skip application"}
            </Button>
            <Button
              variant="contained"
              disabled={
                busy ||
                stale ||
                expired ||
                !reviewed ||
                !evidenceMatches ||
                (!!pending && pending !== "approve")
              }
              onClick={() => void decide("approve")}
              sx={{ minHeight: 44, px: 2.5 }}
            >
              {pending === "approve" ? "Retry same approval" : "Approve & submit"}
            </Button>
          </>
        )
      }
    >
      <QuestionHeading
        id={promptId}
        prompt="Ready to submit. Review before we send it?"
        detail="Check the exact answers and PDF. A changed application needs a new approval."
      />
      {evidenceMatches && attempt ? (
        <SubmissionAttemptDetails
          attempt={attempt}
          campaignId={approval.job.campaignId}
          jobKey={approval.job.key}
        />
      ) : (
        <Alert
          severity="warning"
          action={
            <Button disabled={busy} onClick={() => void reloadRequest()}>
              Reload
            </Button>
          }
        >
          The exact retained answers and PDF are not available for this approval. Reload the request
          before approving.
        </Alert>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {expired && !closed && (
        <Alert severity="warning">
          This approval has expired. Refresh the request to review the current application.
        </Alert>
      )}
      {closed && (
        <Alert severity="info">
          This request has been resolved. The queue shows the current application state.
        </Alert>
      )}
      {!closed && (
        <FormControlLabel
          label="I reviewed these answers and the selected PDF"
          control={
            <Checkbox
              checked={reviewed}
              disabled={busy || stale || expired || !!pending || !evidenceMatches}
              onChange={(_, value) => setReviewed(value)}
            />
          }
        />
      )}
      <Typography variant="body2Muted">
        Approval expires {new Date(approval.expiresAt).toLocaleString()}. The computer still needs
        its separately approved model budget; this decision does not start a model.
      </Typography>
    </QuestionCardFrame>
  );
}
