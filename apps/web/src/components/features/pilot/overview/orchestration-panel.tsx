"use client";

import "@xyflow/react/dist/style.css";
import { type ReactElement, useEffect, useState } from "react";
import type { PilotJournalKind, PilotState } from "@jobpilot/contracts/pilot";
import { Box, Skeleton, Typography, useTheme } from "@mui/material";
import { Background, BackgroundVariant, type Edge, ReactFlow } from "@xyflow/react";
import { useApiQuery } from "@/api/hooks";
import { pilotQueries } from "@/api/queries";
import { SectionCard } from "@/components/ui/layout";
import type { PilotHealth } from "@/lib/terminal";
import { formatTimeUntil, humanizeIsoInText } from "@/utils/format";
import type { TerminalHealth } from "../../agent-dock/use-terminal-health";
import { isHostOffline } from "../host-status";
import { useAgenda } from "./agenda-preview";
import { type StageFlowNode, stageNodeTypes } from "./flow-nodes";
import { useNextWake } from "./use-next-wake";

type StageId = "orchestrator" | "agent" | "worker" | "results";
type Mode = "off" | "offline" | "working" | "sleeping";

interface Stage {
  id: StageId;
  title: string;
  role: string;
  tone: StageFlowNode["data"]["tone"];
}

/** Distinct hues so adjacent agents stay legible; each node also carries a text label. */
const STAGES: Stage[] = [
  { id: "orchestrator", title: "Orchestrator", role: "Host loop", tone: "blue" },
  { id: "agent", title: "Agent", role: "Cycle", tone: "violet" },
  { id: "worker", title: "Worker", role: "Subagent", tone: "amber" },
  { id: "results", title: "Results", role: "Board / API", tone: "green" },
];

const STAGE_SPACING = 220;

/** Which stage the newest journal entry lights up. */
const STAGE_BY_KIND: Record<PilotJournalKind, StageId> = {
  cycle: "agent",
  action: "worker",
  observation: "worker",
  digest: "results",
  question: "results",
  correction: "results",
  system: "orchestrator",
};

function truncate(text: string, max = 72): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function pilotMode(state: PilotState, health: TerminalHealth, pilot: PilotHealth | null): Mode {
  if (!state.running) {
    return "off";
  }
  if (isHostOffline(health)) {
    return "offline";
  }
  return pilot?.conducting ? "working" : "sleeping";
}

function orchestratorCaption(mode: Mode, nextWakeAt: Date | null): string {
  switch (mode) {
    case "off":
      return "Pilot disabled";
    case "offline":
      return "Agent offline";
    case "working":
      return "Running a cycle";
    default:
      return nextWakeAt ? `wakes in ${formatTimeUntil(nextWakeAt)}` : "Idle";
  }
}

interface OrchestrationPanelProps {
  state: PilotState;
  health: TerminalHealth;
  pilot: PilotHealth | null;
}

export function OrchestrationPanel(props: OrchestrationPanelProps): ReactElement {
  const { state, health, pilot } = props;
  const theme = useTheme();
  const journal = useApiQuery(pilotQueries.journal());
  const nextWakeAt = useNextWake();
  const agenda = useAgenda();

  // ReactFlow measures the DOM, so the canvas must never render during SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const mode = pilotMode(state, health, pilot);
  const muted = mode === "off" || mode === "offline";
  const newest = journal.data?.items[0] ?? null;
  const activeStage = mode === "working" && newest ? STAGE_BY_KIND[newest.kind] : "orchestrator";
  const activeIndex = STAGES.findIndex((stage) => stage.id === activeStage);
  const topAgendaItem = agenda.data?.items[0]?.title;
  const latestAction = newest ? humanizeIsoInText(newest.summary) : "";

  const captions: Record<StageId, string> = {
    orchestrator: orchestratorCaption(mode, nextWakeAt),
    agent: topAgendaItem ? `Next: ${truncate(topAgendaItem, 60)}` : "Senses the agenda",
    worker: latestAction ? truncate(latestAction) : "Scores & applies jobs",
    results: `${state.appliedToday} / ${state.instructionsConfig.dailyApplyCap} applied today`,
  };

  const nodes: StageFlowNode[] = STAGES.map((stage, index) => ({
    id: stage.id,
    type: "stage",
    position: { x: index * STAGE_SPACING, y: 40 },
    data: {
      title: stage.title,
      role: stage.role,
      tone: stage.tone,
      caption: captions[stage.id],
      active: mode === "working" && stage.id === activeStage,
      muted,
    },
    draggable: false,
    selectable: false,
  }));

  const flame = theme.palette.accent.primary;
  const dim = theme.palette.divider;
  const edges: Edge[] = STAGES.slice(1).map((stage, index) => {
    const source = STAGES[index].id;
    const lit = index < activeIndex;
    return {
      id: `${source}-${stage.id}`,
      source,
      target: stage.id,
      type: "smoothstep",
      animated: lit,
      style: { stroke: lit ? flame : dim, strokeWidth: lit ? 2 : 1.5 },
    };
  });

  let hint: string | null = null;
  if (mode === "off") {
    hint = "Enable the pilot to watch it run cycles.";
  } else if (mode === "offline") {
    hint = "Start the OpenApply agent so the pilot can run cycles.";
  }

  return (
    <SectionCard title="Orchestration" description="How the pilot works a cycle, live.">
      {mounted ? (
        <Box
          sx={{
            height: 240,
            width: "100%",
            // Strip the library's node/handle/attribution chrome so only our themed surfaces show.
            "& .react-flow__node": {
              background: "transparent",
              border: 0,
              padding: 0,
              fontFamily: "inherit",
            },
            "& .react-flow__handle": { opacity: 0 },
            "& .react-flow__attribution": { display: "none" },
          }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={stageNodeTypes}
            fitView
            fitViewOptions={{ padding: 0.18 }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            proOptions={{ hideAttribution: true }}
            minZoom={0.5}
            maxZoom={1.5}
            colorMode={theme.palette.mode}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} color={dim} />
          </ReactFlow>
        </Box>
      ) : (
        <Skeleton variant="rounded" height={240} />
      )}
      <Box sx={{ mt: 1 }}>
        {hint ? (
          <Typography variant="body2Muted">{hint}</Typography>
        ) : (
          <Typography variant="captionMuted">
            Each cycle the orchestrator wakes the agent, which senses the agenda and delegates a
            worker to act on the job board.
          </Typography>
        )}
      </Box>
    </SectionCard>
  );
}
