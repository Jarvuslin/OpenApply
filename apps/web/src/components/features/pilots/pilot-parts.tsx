"use client";

import type { ReactElement, ReactNode } from "react";
import { Breadcrumbs, Link, Stack, Typography } from "@mui/material";
import {
  BriefcaseBusiness,
  Building2,
  ChartNoAxesColumn,
  ChevronRight,
  MapPin,
} from "lucide-react";
import type { PilotDto } from "@/api/pilot-queries";
import { useQueueCompanion } from "@/hooks/use-queue-companion";
import { COMPANY_TYPE_OPTIONS, experienceLabel } from "./pilot-format";
import { PulseDot } from "./pilot-motion";

const META_ICON = { size: 14, strokeWidth: 1.75, "aria-hidden": true } as const;

const STATUS = {
  running: {
    label: "Looking now",
    tint: "statusTints.info",
    text: "status.info",
    dot: "statusDots.active",
  },
  active: {
    label: "Active",
    tint: "statusTints.success",
    text: "status.success",
    dot: "statusDots.done",
  },
  waiting: {
    label: "Waiting for computer",
    tint: "statusTints.warning",
    text: "status.warning",
    dot: "statusDots.waiting",
  },
  paused: {
    label: "Paused",
    tint: "statusTints.neutral",
    text: "status.neutral",
    dot: "statusDots.neutral",
  },
} as const;

interface PilotStatusPillProps {
  pilot: PilotDto;
}

/** Scoring happens in the companion on the person's computer, so a run stalls without it. */
export function useComputerOffline(): boolean {
  const { query, status } = useQueueCompanion();
  return !query.isPending && (query.isError || !status?.connected);
}

/**
 * Looking now while a run scores jobs (Waiting for computer if the companion is away), Active
 * while auto run is on, otherwise Paused.
 */
export function PilotStatusPill({ pilot }: PilotStatusPillProps): ReactElement {
  const offline = useComputerOffline();
  let status: keyof typeof STATUS = pilot.autoRun ? "active" : "paused";
  if (pilot.lastRun?.state === "scoring") status = offline ? "waiting" : "running";
  const { label, tint, text, dot } = STATUS[status];
  return (
    <Stack
      direction="row"
      spacing={0.75}
      sx={{ alignItems: "center", px: 1, py: 0.25, borderRadius: 1, bgcolor: tint, flexShrink: 0 }}
    >
      <PulseDot color={dot} pulsing={status === "running"} />
      <Typography variant="caption" sx={{ color: text }}>
        {label}
      </Typography>
    </Stack>
  );
}

interface PilotBreadcrumbProps {
  /** The page under Pilots, like the pilot's name or "New pilot". */
  current: string;
}

export function PilotBreadcrumb({ current }: PilotBreadcrumbProps): ReactElement {
  return (
    <Breadcrumbs
      aria-label="Breadcrumb"
      separator={<ChevronRight size={14} aria-hidden />}
      sx={{ typography: "body2", color: "text.secondary" }}
    >
      <Link href="/pilots" underline="hover" color="text.secondary">
        Pilots
      </Link>
      <Typography variant="body2" color="text.primary" noWrap sx={{ maxWidth: 320 }}>
        {current}
      </Typography>
    </Breadcrumbs>
  );
}

interface MetaItemProps {
  icon: ReactNode;
  children: ReactNode;
}

function MetaItem({ icon, children }: MetaItemProps): ReactElement {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", minWidth: 0 }}>
      {icon}
      <Typography variant="captionMuted" noWrap>
        {children}
      </Typography>
    </Stack>
  );
}

interface PilotMetaProps {
  pilot: PilotDto;
}

/** Where, which experience, which companies and how good a fit, each behind its icon. */
export function PilotMeta({ pilot }: PilotMetaProps): ReactElement {
  const { rules } = pilot;
  const companies = COMPANY_TYPE_OPTIONS.filter((option) =>
    rules.companyTypes.includes(option.value),
  ).map((option) => option.label);
  return (
    <Stack
      direction="row"
      sx={{ flexWrap: "wrap", columnGap: 2, rowGap: 0.5, color: "text.secondary" }}
    >
      <MetaItem icon={<MapPin {...META_ICON} />}>
        {rules.locations.join(", ") || "Anywhere"}
      </MetaItem>
      <MetaItem icon={<BriefcaseBusiness {...META_ICON} />}>{experienceLabel(rules)}</MetaItem>
      {companies.length > 0 && (
        <MetaItem icon={<Building2 {...META_ICON} />}>{companies.join(", ")}</MetaItem>
      )}
      <MetaItem icon={<ChartNoAxesColumn {...META_ICON} />}>{pilot.minScore}%+ fit</MetaItem>
    </Stack>
  );
}
