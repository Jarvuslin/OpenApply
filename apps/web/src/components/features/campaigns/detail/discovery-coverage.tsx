"use client";

import { type ReactNode, useState } from "react";
import { Alert, Button, Chip, Link, Stack, TextField, Typography } from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { apiErrorMessage } from "@/api/error";
import { queryKeys } from "@/api/query-keys";
import { type CampaignDetailDto, jobSummary } from "@/api/types";
import { SectionCard } from "@/components/ui/layout";
import { useQueueActions } from "@/hooks/use-queue-actions";
import { summarizeDiscoverySources } from "./discovery-source-summary";

interface DiscoveryCoverageProps {
  campaign: CampaignDetailDto;
}

export function DiscoveryCoverage(props: DiscoveryCoverageProps): ReactNode {
  const { campaign } = props;
  const queue = useQueueActions();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [applicationLimit, setApplicationLimit] = useState(
    String(campaign.config.maxApplications ?? 5),
  );
  const coverage = campaign.config.discovery;
  if (!coverage) return null;
  const summary = jobSummary(campaign);
  const complete = coverage.phase === "complete";
  const preview = coverage.intent === "preview";
  const canRun = campaign.status === "in_progress";
  const validLimit =
    Number.isInteger(Number(applicationLimit)) &&
    Number(applicationLimit) >= 1 &&
    Number(applicationLimit) <= 500;
  const applicationCount = validLimit ? applicationLimit : "…";

  async function run(apply: boolean): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (apply && preview) {
        const result = await api["job-sources"]
          ["profile-list"]({ id: campaign.campaignId })
          .apply.post({ maxApplications: Number(applicationLimit) });
        if (result.error) throw new Error(apiErrorMessage(result.error));
        await queryClient.invalidateQueries({
          queryKey: queryKeys.campaigns.detail(campaign.campaignId),
        });
      }
      await queue.campaign.mutateAsync({ campaignId: campaign.campaignId, action: "start" });
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not continue this candidate list.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Saved candidate list">
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
          <Chip
            label={complete ? "Collection complete" : "Collecting and scoring"}
            color={complete ? "success" : "default"}
          />
          <Chip label={`${summary?.totalFound ?? 0} saved candidates`} />
          <Chip label={`${summary?.scored ?? 0} scores saved`} />
          <Chip label={`Minimum fit: ${campaign.config.minScore ?? "Not set"}/100`} />
          <Chip
            label={
              preview ? "Preview only" : `Apply to up to ${campaign.config.maxApplications ?? 5}`
            }
          />
        </Stack>
        <Typography variant="body2" color="text.secondary">
          Open a candidate below to see its original-resume score, evidence, gaps and separate
          preference checks. Unscored or unresolved candidates are not ready to apply.
        </Typography>
        {campaign.config.resumeId && (
          <Link href={`/resumes/${campaign.config.resumeId}`} variant="body2">
            View the source resume used for this list
          </Link>
        )}
        <Typography variant="body2">
          Searches:{" "}
          {coverage.searches
            .map((search) => `${search.query}${search.location ? ` in ${search.location}` : ""}`)
            .join("; ")}
        </Typography>
        {coverage.sources.length === 0 && (
          <Alert severity="info">
            No source requests have been recorded yet. This list does not establish search coverage
            until the agent collects results.
          </Alert>
        )}
        {summarizeDiscoverySources(coverage.sources).map((source) => (
          <Stack
            key={source.source}
            spacing={0.5}
            sx={{ p: 1.5, border: 1, borderColor: "divider", borderRadius: 2 }}
          >
            <Typography variant="subtitle2">{source.source}</Typography>
            <Typography variant="body2" color="text.secondary">
              {source.fetched} results fetched · {source.saved} added to this list ·{" "}
              {source.resolved} employer pages resolved · {source.requests} requests
            </Typography>
            {source.truncated && (
              <Typography variant="body2" color="warning.main">
                A result limit was reached. More openings may remain at this source.
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary">
              Last checked {new Date(source.checkedAt).toLocaleString()}
            </Typography>
          </Stack>
        ))}
        <Typography variant="caption" color="text.secondary">
          Counts reflect observed source requests and can include repeated results. The saved list
          is deduplicated. Search coverage is limited to the sources checked and your candidate
          limit of {campaign.config.maxJobs ?? "not set"}.
        </Typography>
        {coverage.reason && <Alert severity="info">{coverage.reason}</Alert>}
        {!canRun && (
          <Alert severity="info">
            {campaign.status === "paused"
              ? "This list is paused. Use Resume above to continue with its saved settings."
              : "This list is closed. Its saved candidates and application records remain available."}
          </Alert>
        )}
        {preview && (
          <Typography variant="body2">
            This search does not submit applications. Once collection and scoring finish, you can
            authorize applications from this saved list.
          </Typography>
        )}
        {preview && complete && (
          <TextField
            label="Maximum applications from this list"
            type="number"
            value={applicationLimit}
            onChange={(event) => setApplicationLimit(event.target.value)}
            disabled={busy}
            slotProps={{ htmlInput: { min: 1, max: 500, step: 1 } }}
            sx={{ maxWidth: 360 }}
          />
        )}
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          {!complete && (
            <Button
              variant="outlined"
              disabled={busy || !canRun}
              onClick={() => void run(!preview)}
            >
              Continue collecting and scoring
            </Button>
          )}
          {complete && (
            <Button
              variant="contained"
              disabled={busy || !canRun || (preview && !validLimit)}
              onClick={() => void run(true)}
            >
              {preview
                ? `Apply to up to ${applicationCount} jobs from this list`
                : "Continue applications from this list"}
            </Button>
          )}
        </Stack>
        {error && <Alert severity="error">{error}</Alert>}
      </Stack>
    </SectionCard>
  );
}
