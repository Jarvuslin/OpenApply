"use client";

import type { ReactElement } from "react";
import { Box, Card, CardActionArea, Chip, Stack, Tooltip, Typography } from "@mui/material";
import type { CampaignDto } from "@/api/types";
import { formatRelativeTime } from "@/utils/format";
import { CAMPAIGN_SOURCE_LABELS } from "./campaign-progress";
import { CampaignStatusChip } from "./campaign-status-chip";
import { PilotBadge } from "./pilot-badge";

interface CampaignRowProps {
  campaign: CampaignDto;
}

function summaryLine(campaign: CampaignDto): string {
  const s = campaign.summary;
  if (campaign.source === "search")
    return `${s.totalFound} found · ${s.scored} scored · ${s.qualified} qualified`;
  const tail = s.remaining > 0 ? ` · ${s.remaining} left` : "";
  return `${s.applied} applied · ${s.failed} failed · ${s.skipped} skipped${tail}`;
}

// A high skip count is normal and reads like a fault without this.
function summaryHint(): string {
  return "Applied: submitted. Failed: the application errored. Skipped: below your match score, already applied, or the posting states a requirement you can't meet. Left: still waiting.";
}

export function CampaignRow(props: CampaignRowProps): ReactElement {
  const { campaign } = props;

  return (
    <Card variant="interactive" sx={{ position: "relative" }}>
      <CardActionArea
        href={`/campaigns/${encodeURIComponent(campaign.campaignId)}`}
        sx={{ padding: 1.25 }}
      >
        <Stack spacing={0.5} sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
            <CampaignStatusChip status={campaign.status} />
            <Chip size="small" label={CAMPAIGN_SOURCE_LABELS[campaign.source]} variant="outlined" />
            <PilotBadge createdBy={campaign.createdBy} />
            <Box sx={{ flex: 1 }} />
            <Typography variant="captionMuted" noWrap>
              {formatRelativeTime(campaign.startedAt)}
            </Typography>
          </Stack>
          <Typography variant="body2Strong" noWrap>
            {campaign.query}
          </Typography>
          <Tooltip
            title={
              campaign.source === "search"
                ? "Found: discovered jobs. Scored: jobs reviewed against your resume. Qualified: jobs ready to apply."
                : summaryHint()
            }
            enterDelay={400}
          >
            <Typography variant="captionMuted" sx={{ alignSelf: "flex-start" }}>
              {summaryLine(campaign)}
            </Typography>
          </Tooltip>
        </Stack>
      </CardActionArea>
    </Card>
  );
}
