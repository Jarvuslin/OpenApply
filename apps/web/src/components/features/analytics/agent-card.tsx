"use client";

import type { ReactElement } from "react";
import { Box, Divider, Stack, Tooltip, Typography } from "@mui/material";
import { Sparkles } from "lucide-react";
import type { AnalyticsStatsDto } from "@/api/types";
import { SectionCard } from "@/components/ui/layout";

interface AgentCardProps {
  stats: AnalyticsStatsDto;
}

function duration(seconds: number | null): string {
  if (seconds == null) return "—";
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

interface TileProps {
  label: string;
  value: string;
  caption: string;
  definition: string;
}

function Tile({ label, value, caption, definition }: TileProps): ReactElement {
  return (
    <Tooltip title={definition} arrow placement="top-start">
      <Box sx={{ minWidth: 0, cursor: "help" }}>
        <Typography variant="captionMuted" component="p">
          {label}
        </Typography>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: "baseline", minWidth: 0 }}>
          <Typography variant="body1Strong" sx={{ flexShrink: 0 }}>
            {value}
          </Typography>
          <Typography variant="captionMuted" noWrap>
            {caption}
          </Typography>
        </Stack>
      </Box>
    </Tooltip>
  );
}

/** How the agent runs on its own: success, speed, what it asked you and the accounts it made. */
export function AgentCard({ stats }: AgentCardProps): ReactElement {
  const { agent, topRejectReasons } = stats;
  const success = agent.runs ? `${Math.round((agent.submitted / agent.runs) * 100)}%` : "—";
  return (
    <SectionCard
      fullHeight
      title="Agent"
      icon={<Sparkles size={18} strokeWidth={1.75} aria-hidden />}
    >
      <Stack spacing={1.75}>
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
          <Tile
            label="Run success"
            value={success}
            caption={`${agent.submitted} of ${agent.runs} runs submitted`}
            definition="Finished agent runs that ended in a submitted application. Retries count as separate runs."
          />
          <Tile
            label="Avg run time"
            value={duration(agent.avgRunSeconds)}
            caption="per application"
            definition="Time the agent spent on each submitted application, across all its runs."
          />
          <Tile
            label="Asked you"
            value={String(agent.questionsAsked)}
            caption={`${agent.questionsOpen} still open`}
            definition="Questions the agent couldn't answer from your profile and sent to Needs you."
          />
          <Tile
            label="Accounts created"
            value={`${agent.accountsVerified} of ${agent.accountsCreated}`}
            caption="verified by email"
            definition="Employer accounts the agent signed up for, and how many it verified through your email."
          />
        </Box>
        <Divider />
        <Stack spacing={0.75}>
          <Typography variant="body2Strong">Why runs stopped</Typography>
          {topRejectReasons.length === 0 && (
            <Typography variant="captionMuted">No stopped runs.</Typography>
          )}
          {topRejectReasons.map((row) => (
            <Stack key={row.reason} direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Box
                sx={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  bgcolor: "error.main",
                  flexShrink: 0,
                }}
              />
              <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
                {row.reason}
              </Typography>
              <Typography variant="body2Strong">{row.count}</Typography>
            </Stack>
          ))}
        </Stack>
      </Stack>
    </SectionCard>
  );
}
