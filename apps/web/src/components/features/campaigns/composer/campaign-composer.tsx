"use client";

import type { ReactElement } from "react";
import { Alert, Box, Button, LinearProgress, Stack, Tooltip } from "@mui/material";
import { useSelector } from "@tanstack/react-form";
import { useRouter } from "next/navigation";
import { api } from "@/api/client";
import { ApiError } from "@/api/error";
import { useApiMutation, useApiQuery } from "@/api/hooks";
import { campaignQueries, jobBoardQueries, userQueries } from "@/api/queries";
import { invalidations } from "@/api/query-keys";
import type { CampaignDto, CreateCampaignRequest } from "@/api/types";
import { useAppForm } from "@/components/ui/form/tanstack";
import { SectionCard } from "@/components/ui/layout";
import { useSession } from "@/hooks/use-auth";
import { getStoredProvider } from "@/lib/agent-storage";
import { queueRequests, sendQueueRequest } from "@/lib/queue-request";
import { ApplyFields } from "./apply-fields";
import { AutoApplyFields } from "./auto-apply-fields";
import { CampaignBasicsFields } from "./campaign-basics-fields";
import {
  buildCreateCampaignRequest,
  COMPOSER_DEFAULT_VALUES,
  composerFormSchema,
  SUBMIT_LABELS,
} from "./form-config";

export function CampaignComposer(): ReactElement {
  const router = useRouter();
  const { user } = useSession();

  const boardsQuery = useApiQuery(jobBoardQueries.list());
  const profileQuery = useApiQuery(userQueries.detail());
  const recentCampaignsQuery = useApiQuery(campaignQueries.list());

  const boards = boardsQuery.data ?? [];

  const createCampaign = useApiMutation<CampaignDto, CreateCampaignRequest>(
    async (body) => {
      const provider = getStoredProvider();
      const data = await sendQueueRequest(
        queueRequests,
        user?.id ?? "",
        ["create-campaign", body, provider],
        async (idempotencyKey) => {
          const created = await api.campaigns.post({ ...body, clientCampaignId: idempotencyKey });
          if (created.error) throw new ApiError(created.error);
          const queued = await api["work-queue"]
            .campaign({ id: created.data.campaignId })
            .post({ idempotencyKey, action: "start", provider });
          if (queued.error) throw new ApiError(queued.error);
          return created.data;
        },
      );
      return { data, error: null };
    },
    {
      invalidate: invalidations.queue,
      retry: false,
      successMessage: "Search added to your queue.",
    },
  );

  const resumes = profileQuery.data?.resumes ?? [];
  const recentQueries = Array.from(
    new Set((recentCampaignsQuery.data?.items ?? []).map((r) => r.query)),
  ).slice(0, 5);

  const hasBoards = boards.length > 0;
  const hasResumes = resumes.length > 0;

  const form = useAppForm({
    defaultValues: {
      ...COMPOSER_DEFAULT_VALUES,
      board: boards[0]?.domain ?? "",

      resumeId: resumes.find((r) => r.isPrimary)?.id ?? resumes[0]?.id ?? "",
      minScore: profileQuery.data?.autoApply?.minMatchScore ?? COMPOSER_DEFAULT_VALUES.minScore,
    },
    validators: { onSubmit: composerFormSchema },
    onSubmit: async ({ value }) => {
      const campaign = await createCampaign.mutateAsync(buildCreateCampaignRequest(value));
      const campaignId = campaign.campaignId;
      router.push(`/campaigns/${encodeURIComponent(campaignId)}`);
    },
  });

  const mode = useSelector(form.store, (s) => s.values.mode);

  const isApply = mode === "apply";
  let setupHint = "";
  if (!isApply && !hasResumes && !hasBoards)
    setupHint = "Add a job board and upload a resume first.";
  else if (!isApply && !hasBoards) setupHint = "Add a job board first.";
  else if (!isApply && !hasResumes) setupHint = "Upload a resume first.";

  if (boardsQuery.isLoading || profileQuery.isLoading) {
    return <LinearProgress />;
  }

  if (boardsQuery.isError || profileQuery.isError) {
    return (
      <Alert
        severity="error"
        action={
          <Button
            color="inherit"
            onClick={() => {
              void boardsQuery.refetch();
              void profileQuery.refetch();
            }}
          >
            Retry
          </Button>
        }
      >
        Could not load your search setup.
      </Alert>
    );
  }

  return (
    <SectionCard>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
      >
        <Stack spacing={2.5}>
          <CampaignBasicsFields
            form={form}
            boards={boards}
            resumes={resumes}
            recentQueries={recentQueries}
          />

          {mode === "search" && (
            <form.AppField name="maxJobs">
              {(field) => (
                <field.TextField
                  label="Jobs to search"
                  type="number"
                  helperText="How many results to rank. Leave empty for unlimited."
                  slotProps={{ htmlInput: { min: 1, step: 1 } }}
                />
              )}
            </form.AppField>
          )}
          {mode === "auto_apply" && <AutoApplyFields form={form} />}

          {mode === "apply" && <ApplyFields form={form} />}

          <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
            <Button onClick={() => router.back()}>Cancel</Button>
            <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting] as const}>
              {([canSubmit, isSubmitting]) => (
                <Tooltip
                  title={setupHint || (!canSubmit ? "Complete the required fields above." : "")}
                >
                  <Box component="span">
                    <Button
                      type="submit"
                      variant="contained"
                      disabled={!canSubmit || isSubmitting || Boolean(setupHint)}
                    >
                      {isSubmitting ? "Starting…" : SUBMIT_LABELS[mode]}
                    </Button>
                  </Box>
                </Tooltip>
              )}
            </form.Subscribe>
          </Stack>
        </Stack>
      </form>
    </SectionCard>
  );
}
