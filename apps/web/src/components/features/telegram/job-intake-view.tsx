"use client";

import { type ReactElement, useState } from "react";
import {
  Alert,
  Button,
  LinearProgress,
  Link,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { intakeDecisionSchema, intakePrepareSchema } from "@openapply/contracts/job-intake";
import { useQueryClient } from "@tanstack/react-query";
import type { Route } from "next";
import NextLink from "next/link";
import { api } from "@/api/client";
import { ApiError } from "@/api/error";
import { useApiQuery } from "@/api/hooks";
import { queryKeys } from "@/api/query-keys";
import { telegramQueries } from "@/api/telegram-queries";
import { SectionCard } from "@/components/ui/layout";
import { useSession } from "@/hooks/use-auth";
import { useHydrated } from "@/hooks/use-hydrated";
import { queueRequests, sendQueueRequest } from "@/lib/queue-request";
import { intakeRequest, type PendingIntakeAction } from "./intake-request";

interface JobIntakeViewProps {
  id: string;
}

export function JobIntakeView(props: JobIntakeViewProps): ReactElement {
  const hydrated = useHydrated();
  if (!hydrated) return <LinearProgress aria-label="Loading linked job" />;
  return <OwnedJobIntake id={props.id} />;
}

function OwnedJobIntake(props: JobIntakeViewProps): ReactElement {
  const { user } = useSession();
  if (!user) return <LinearProgress aria-label="Loading linked job account" />;
  return <JobIntakeContent key={`${user.id}:${props.id}`} id={props.id} />;
}

function JobIntakeContent(props: JobIntakeViewProps): ReactElement {
  const { id } = props;
  const { user } = useSession();
  const client = useQueryClient();
  const intake = useApiQuery(telegramQueries.intake(id), { retry: false, refetchInterval: 15_000 });
  const [provider, setProvider] = useState<"claude" | "codex" | "">("");
  const [pending, setPending] = useState<PendingIntakeAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const row = intake.data;
  const selectedProvider = row?.provider ?? provider;
  const closed = row?.decision !== "pending";
  const locked = busy || stale || !!intake.error || !row || closed;
  async function act(action: PendingIntakeAction["action"]): Promise<void> {
    if (!row || locked || (pending && pending.action !== action)) return;
    const input = intakeRequest(
      {
        intakeId: id,
        accountId: user?.id ?? "",
        revision: row.revision,
        provider: selectedProvider || undefined,
      },
      action,
      pending,
    );
    if (!input) {
      setError(
        "The pending request belongs to another account or candidate. Reload this job before acting.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      await sendQueueRequest(
        queueRequests,
        user?.id ?? "",
        ["job-intake", id, input],
        async (requestId) => {
          const route = api["job-intakes"]({ id });
          const response =
            action === "prepare"
              ? await route.prepare.post(
                  intakePrepareSchema.parse({
                    requestId,
                    expectedRevision: input.revision,
                    provider: input.provider,
                  }),
                )
              : await route.decision.post(
                  intakeDecisionSchema.parse({
                    requestId,
                    expectedRevision: input.revision,
                    decision: input.action,
                    ...(input.provider ? { provider: input.provider } : {}),
                  }),
                );
          if (response.error) throw new ApiError(response.error);
          return response.data;
        },
      );
      setPending(null);
      await intake.refetch();
      void client.invalidateQueries({ queryKey: queryKeys.queue.all });
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        setStale(true);
        setPending(null);
        setError(
          "The candidate changed or is not ready for this action. Reload the job and review its current requirements.",
        );
      } else if (reason instanceof ApiError && reason.status !== undefined && reason.status < 500) {
        setPending(null);
        setError(
          "This action was rejected. Reload the candidate and check its current requirements before trying again.",
        );
      } else {
        setPending(input);
        setError(
          "The action was not acknowledged. Retry the same action or reload the job to inspect its state.",
        );
      }
    } finally {
      setBusy(false);
    }
  }
  async function reload(): Promise<void> {
    setBusy(true);
    try {
      const result = await intake.refetch();
      if (result.error) throw result.error;
      setPending(null);
      setStale(false);
      setError("");
    } catch {
      setError("Could not reload the saved candidate.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack spacing={2}>
      {intake.isLoading && <LinearProgress aria-label="Loading linked job" />}
      {intake.error && (
        <Alert severity="error">
          Could not load this candidate. Its current application state is unknown; reload before
          acting.
        </Alert>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      <Button disabled={busy} onClick={() => void reload()}>
        Reload linked job
      </Button>
      {row && (
        <SectionCard
          title={row.title || "Linked job"}
          description={row.company ?? "Company not yet resolved"}
        >
          <Stack spacing={2} data-job-intake-id={row.id} data-job-intake-revision={row.revision}>
            <Typography>Preparation: {row.preparation.replaceAll("_", " ")}</Typography>
            <Typography>Decision: {row.decision.replaceAll("_", " ")}</Typography>
            <Typography>
              Fit: {row.matchScore === null ? "Pending assessment" : `${row.matchScore}%`}
            </Typography>
            <Typography>
              Questions:{" "}
              {row.questionsPending
                ? "Still need collection or review"
                : "Current collection available"}
              {` · ${row.unansweredCount} unanswered`}
            </Typography>
            {row.reason && <Alert severity="info">{row.reason}</Alert>}
            <Link href={row.canonicalUrl} target="_blank" rel="noopener noreferrer">
              View saved posting
            </Link>
            {row.campaignId && row.jobKey && (
              <Link component={NextLink} href={`/campaigns/${row.campaignId}` as Route}>
                Review job details, resume and questions
              </Link>
            )}
            <Link component={NextLink} href="/needs-you">
              Open Needs you
            </Link>
            <Link component={NextLink} href="/resumes">
              Manage original resumes
            </Link>
            {!closed && (
              <>
                {row.provider && (
                  <Typography>
                    Selected provider: {row.provider === "claude" ? "Claude" : "Codex"}
                  </Typography>
                )}
                {!row.provider && (
                  <TextField
                    select
                    label="Provider for this candidate"
                    value={provider}
                    disabled={locked || !!pending}
                    onChange={(event) => {
                      if (event.target.value === "claude" || event.target.value === "codex")
                        setProvider(event.target.value);
                    }}
                  >
                    <MenuItem value="" disabled>
                      Choose a provider
                    </MenuItem>
                    <MenuItem value="claude">Claude</MenuItem>
                    <MenuItem value="codex">Codex</MenuItem>
                  </TextField>
                )}
                <Typography variant="body2" color="text.secondary">
                  Preparation is queued separately. A provider selection or application decision
                  does not grant model spending.
                </Typography>
                {row.preparation !== "ready" && row.preparation !== "already_applied" && (
                  <Alert severity="info">
                    Preparation waits for a compatible companion and a separate, finite approval for
                    this exact job. It cannot submit an application.
                  </Alert>
                )}
                {row.preparation !== "ready" && row.preparation !== "already_applied" && (
                  <Button
                    variant="outlined"
                    disabled={
                      locked || !selectedProvider || (!!pending && pending.action !== "prepare")
                    }
                    onClick={() => void act("prepare")}
                  >
                    {pending?.action === "prepare"
                      ? "Retry same preparation request"
                      : "Prepare this job"}
                  </Button>
                )}
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                  <Button
                    variant="contained"
                    disabled={
                      locked ||
                      row.preparation !== "ready" ||
                      !selectedProvider ||
                      (!!pending && pending.action !== "apply_now")
                    }
                    onClick={() => void act("apply_now")}
                  >
                    {pending?.action === "apply_now" ? "Retry same Apply now request" : "Apply now"}
                  </Button>
                  <Button
                    variant="outlined"
                    disabled={
                      locked ||
                      row.preparation !== "ready" ||
                      !selectedProvider ||
                      (!!pending && pending.action !== "queue")
                    }
                    onClick={() => void act("queue")}
                  >
                    {pending?.action === "queue" ? "Retry same queue request" : "Add to queue"}
                  </Button>
                  <Button
                    disabled={locked || (!!pending && pending.action !== "skip")}
                    onClick={() => void act("skip")}
                  >
                    {pending?.action === "skip" ? "Retry same skip request" : "Skip candidate"}
                  </Button>
                </Stack>
              </>
            )}
            {row.workItemId && (
              <Link component={NextLink} href="/queue">
                View queued work
              </Link>
            )}
          </Stack>
        </SectionCard>
      )}
    </Stack>
  );
}
