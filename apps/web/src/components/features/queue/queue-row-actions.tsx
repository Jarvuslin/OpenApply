"use client";

import type { ReactElement } from "react";
import { Button, IconButton, Stack } from "@mui/material";
import {
  Clock,
  ExternalLink,
  Eye,
  FileCheck,
  MoreHorizontal,
  Pause,
  Play,
  RotateCcw,
  Square,
  Trash2,
} from "lucide-react";
import type { QueueItemDto } from "@/api/queue-queries";
import { DropdownMenu } from "@/components/ui/feedback";
import { canPause, canRetry, canStop, isWorking } from "./queue-state";
import { useQueueControls } from "./use-queue-controls";

const ICON = { size: 14, strokeWidth: 1.75, "aria-hidden": true } as const;

interface QueueRowActionsProps {
  item: QueueItemDto;
  /** Opens the side panel on this job, optionally scrolled to its activity. */
  onOpen: (activity?: boolean) => void;
}

export function QueueRowActions({ item, onOpen }: QueueRowActionsProps): ReactElement {
  const controls = useQueueControls(item);
  const retryLabel = item.state === "paused" ? "Resume" : "Retry";
  let primary: ReactElement | null = null;
  if (canPause(item.state))
    primary = (
      <Button
        size="small"
        variant="outlined"
        startIcon={<Pause {...ICON} />}
        disabled={controls.busy || !!item.pauseRequestedAt}
        onClick={controls.pause}
      >
        Pause
      </Button>
    );
  // Needs-you rows only get the menu: the answer itself happens in the side panel.
  else if (
    item.state === "paused" ||
    (item.state !== "needs_user" && canRetry(item.state, item.intent))
  )
    primary = (
      <Button
        size="small"
        variant="outlined"
        startIcon={item.state === "paused" ? <Play {...ICON} /> : <RotateCcw {...ICON} />}
        disabled={controls.busy}
        onClick={controls.resume}
      >
        {retryLabel}
      </Button>
    );
  else if (item.state === "submitted" && item.hasScreenshot)
    primary = (
      <Button
        size="small"
        variant="outlined"
        startIcon={<FileCheck {...ICON} />}
        onClick={() => onOpen()}
      >
        View
      </Button>
    );
  return (
    <Stack
      direction="row"
      spacing={0.5}
      onClick={(event) => event.stopPropagation()}
      sx={{ alignItems: "center", justifyContent: "flex-end" }}
    >
      {primary}
      <DropdownMenu
        minWidth={212}
        trigger={({ onOpen: openMenu, open }) => (
          <IconButton
            size="small"
            aria-label={`More actions for ${item.title}`}
            aria-expanded={open}
            onClick={openMenu}
            sx={open ? { bgcolor: "surfaces.hover" } : undefined}
          >
            <MoreHorizontal size={16} strokeWidth={1.75} aria-hidden />
          </IconButton>
        )}
        items={[
          {
            kind: "item",
            key: "site",
            label: "Open career site",
            icon: <ExternalLink {...ICON} />,
            show: !!item.url,
            onClick: () => window.open(item.url ?? "", "_blank", "noopener,noreferrer"),
          },
          {
            kind: "item",
            key: "live",
            label: "Show live view",
            icon: <Eye {...ICON} />,
            show: isWorking(item.state),
            onClick: () => onOpen(),
          },
          {
            kind: "item",
            key: "activity",
            label: "Activity",
            icon: <Clock {...ICON} />,
            onClick: () => onOpen(true),
          },
          { kind: "divider", key: "d1", show: canStop(item.state) },
          {
            kind: "item",
            key: "stop",
            label: "Stop this run",
            icon: <Square {...ICON} />,
            show: canStop(item.state),
            disabled: controls.busy,
            onClick: () => void controls.stop(),
          },
          {
            kind: "item",
            key: "remove",
            label: "Remove from queue",
            icon: <Trash2 {...ICON} />,
            danger: true,
            disabled: controls.busy || item.state === "stopping",
            onClick: () => void controls.remove(),
          },
        ]}
      />
    </Stack>
  );
}
