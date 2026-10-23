"use client";

import { type ReactElement, useState } from "react";
import { AutoAwesome } from "@mui/icons-material";
import {
  Alert,
  Button,
  DialogActions,
  DialogContent,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
import NextLink from "next/link";
import { api } from "@/api/client";
import { ApiError, apiErrorMessage } from "@/api/error";
import { invalidations } from "@/api/query-keys";
import { Dialog, DialogTitle } from "@/components/ui/feedback";
import { useSession } from "@/hooks/use-auth";
import { getStoredProvider } from "@/lib/agent-storage";
import { queueRequests, sendQueueRequest } from "@/lib/queue-request";
import { type ApplicationPlan, queueSelectedJobs } from "./saved-apply-flow";

interface SavedApplyProps {
  count: number;
}

export function SavedApply(props: SavedApplyProps): ReactElement {
  const { count } = props;
  const { user } = useSession();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [slugs, setSlugs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");
  const [plan, setPlan] = useState<ApplicationPlan | null>(null);

  async function review(): Promise<void> {
    setError("");
    setOpen(true);
    if (plan?.remainingSlugs.length) return;
    setBusy(true);
    setSlugs([]);
    setPlan(null);
    try {
      const selected = new Set<string>();
      let page = 1;
      for (;;) {
        const result = await api.jobs.saved.slugs.get({ query: { page, limit: 100 } });
        if (result.error) throw new Error(apiErrorMessage(result.error));
        for (const job of result.data.items) selected.add(job.slug);
        if (page >= result.data.pagination.totalPages) break;
        page += 1;
      }
      setSlugs([...selected].sort());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load saved jobs.");
    } finally {
      setBusy(false);
    }
  }

  async function apply(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError("");
    const selected = plan?.remainingSlugs.length
      ? plan
      : { remainingSlugs: slugs, campaignId: null, workItemIds: [], queued: 0, skipped: [] };
    setPlan(selected);
    const provider = getStoredProvider();
    try {
      const completed = await queueSelectedJobs(
        selected,
        (batch) =>
          sendQueueRequest(
            queueRequests,
            user?.id ?? "",
            ["mvp.apply", batch, provider],
            async (idempotencyKey) => {
              const result = await api.mvp.apply.post({ slugs: batch, idempotencyKey, provider });
              if (result.error) throw new ApiError(result.error);
              return result.data;
            },
          ),
        setPlan,
      );
      const suffix = completed.skipped.length
        ? ` ${completed.skipped.length} skipped: ${[...new Set(completed.skipped)].join("; ")}.`
        : "";
      setSummary(
        `${completed.workItemIds.length} jobs are in your application queue.${suffix} They stay saved until a computer is ready. Your saved list is unchanged.`,
      );
      for (const queryKey of invalidations.queue) await queryClient.invalidateQueries({ queryKey });
      setOpen(false);
    } catch (reason) {
      setError(
        `${reason instanceof Error ? reason.message : "Could not confirm queue admission."} Retry to recover the same selected jobs.`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack spacing={1.5}>
      <Button
        variant="contained"
        startIcon={<AutoAwesome fontSize="sm" />}
        disabled={busy || count === 0}
        onClick={() => void review()}
        sx={{ alignSelf: "flex-start" }}
      >
        Add all saved to queue
      </Button>
      {summary && <Alert severity="info">{summary}</Alert>}
      {error && !open && <Alert severity="error">{error}</Alert>}
      {plan && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
          <Button component={NextLink} href="/queue">
            View queue
          </Button>
          {plan.remainingSlugs.length > 0 && (
            <Button disabled={busy} onClick={() => setOpen(true)}>
              Continue queueing ({plan.remainingSlugs.length})
            </Button>
          )}
        </Stack>
      )}
      <Dialog
        open={open}
        onClose={() => !busy && setOpen(false)}
        fullWidth
        maxWidth="sm"
        aria-labelledby="saved-apply-title"
      >
        <DialogTitle id="saved-apply-title">Add all saved jobs to your queue</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Typography>
              Your agent will review and submit applications for the {slugs.length}{" "}
              {slugs.length === 1 ? "job" : "jobs"} in this saved selection, using your profile and
              resume. It will ask when required information is missing.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              This includes all saved jobs, across every page. Already applied or unavailable jobs
              are skipped. Saving a job by itself never starts an application.
            </Typography>
            <Alert severity="info">
              You can add work while your computer is offline. Follow progress and connect your
              computer from Queue.
            </Alert>
            {!busy && !error && slugs.length === 0 && (
              <Typography>No saved jobs are waiting for an application.</Typography>
            )}
            {busy && <LinearProgress />}
            {error && (
              <Alert
                severity="error"
                action={
                  !slugs.length && !busy && <Button onClick={() => void review()}>Retry</Button>
                }
              >
                {error}
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={busy}>
            Keep browsing
          </Button>
          <Button variant="contained" disabled={busy || !slugs.length} onClick={() => void apply()}>
            {plan?.remainingSlugs.length ? "Continue queueing" : `Queue ${slugs.length} saved jobs`}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
