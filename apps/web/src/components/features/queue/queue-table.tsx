"use client";

import type { ReactElement, ReactNode } from "react";
import { Box, Stack, Typography } from "@mui/material";
import { Briefcase, Building2, Loader, PenLine, Target } from "lucide-react";
import type { QueueItemDto } from "@/api/queue-queries";
import { CompanyLogo } from "@/components/ui/display";
import { QueueRowActions } from "./queue-row-actions";
import { queueNote } from "./queue-state";
import { FitMeter, QueueStatus } from "./queue-status";

const HEADER_ICON = { size: 15, strokeWidth: 1.75, "aria-hidden": true } as const;

interface QueueTableProps {
  items: QueueItemDto[];
  selectedId: string | null;
  /** The side panel is open, so the table drops its Fit column to keep titles readable. */
  compact: boolean;
  onSelect: (id: string, activity?: boolean) => void;
}

export function QueueTable(props: QueueTableProps): ReactElement {
  const { items, selectedId, compact, onSelect } = props;
  const columns = compact
    ? "minmax(0, 1.4fr) minmax(0, 1fr) 132px auto"
    : "minmax(0, 2.6fr) minmax(0, 1fr) 120px 150px auto";
  return (
    <Box role="table" aria-label="Queue" sx={{ display: "grid", gridTemplateColumns: columns }}>
      <Box role="row" sx={{ display: "contents" }}>
        <HeaderCell icon={<PenLine {...HEADER_ICON} />}>Job</HeaderCell>
        <HeaderCell icon={<Building2 {...HEADER_ICON} />}>Company</HeaderCell>
        {!compact && <HeaderCell icon={<Target {...HEADER_ICON} />}>Fit</HeaderCell>}
        <HeaderCell icon={<Loader {...HEADER_ICON} />}>Status</HeaderCell>
        <HeaderCell last label="Actions" />
      </Box>
      {items.map((item) => {
        const selected = item.id === selectedId;
        return (
          <Box
            key={item.id}
            role="row"
            aria-selected={selected}
            tabIndex={0}
            onClick={() => onSelect(item.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && event.target === event.currentTarget) onSelect(item.id);
            }}
            sx={{
              display: "contents",
              cursor: "pointer",
              "& > *": { bgcolor: selected ? "surfaces.hover" : "transparent" },
              "&:hover > *": { bgcolor: "surfaces.hover" },
              "&:focus-visible > *": { bgcolor: "surfaces.hover" },
            }}
          >
            <Cell>
              <Box sx={{ display: "flex", color: "text.secondary", flexShrink: 0 }}>
                <Briefcase size={15} strokeWidth={1.75} aria-hidden />
              </Box>
              <Stack sx={{ minWidth: 0 }}>
                <Typography variant="body2" noWrap title={item.title}>
                  {item.title}
                </Typography>
                <Typography variant="captionMuted" noWrap title={queueNote(item)}>
                  {queueNote(item)}
                </Typography>
              </Stack>
            </Cell>
            <Cell>
              <CompanyLogo url={item.url} size={24} />
              <Typography variant="body2Strong" noWrap title={item.company ?? undefined}>
                {item.company ?? "—"}
              </Typography>
            </Cell>
            {!compact && (
              <Cell>
                <FitMeter score={item.matchScore} />
              </Cell>
            )}
            <Cell>
              <QueueStatus state={item.state} />
            </Cell>
            <Cell last>
              <QueueRowActions item={item} onOpen={(activity) => onSelect(item.id, activity)} />
            </Cell>
          </Box>
        );
      })}
    </Box>
  );
}

interface CellProps {
  children: ReactNode;
  /** The trailing column draws no right divider. */
  last?: boolean;
}

interface HeaderCellProps {
  children?: ReactNode;
  icon?: ReactNode;
  /** Accessible name for a column whose header shows no text. */
  label?: string;
  last?: boolean;
}

function HeaderCell({ children, icon, label, last = false }: HeaderCellProps): ReactElement {
  return (
    <Stack
      role="columnheader"
      aria-label={label}
      direction="row"
      spacing={1}
      sx={{
        alignItems: "center",
        minHeight: 40,
        px: 2,
        bgcolor: "surfaces.elevated",
        borderBottom: 1,
        borderRight: last ? 0 : 1,
        borderColor: "divider",
      }}
    >
      {icon && <Box sx={{ display: "flex", color: "text.primary" }}>{icon}</Box>}
      <Typography variant="body2Strong" noWrap>
        {children}
      </Typography>
    </Stack>
  );
}

function Cell({ children, last = false }: CellProps): ReactElement {
  return (
    <Stack
      role="cell"
      direction="row"
      spacing={1.25}
      sx={{
        alignItems: "center",
        minWidth: 0,
        minHeight: 52,
        px: 2,
        py: 1,
        borderBottom: 1,
        borderRight: last ? 0 : 1,
        borderColor: "divider",
        justifyContent: last ? "flex-end" : "flex-start",
        transition: (theme) => theme.transitions.create("background-color"),
      }}
    >
      {children}
    </Stack>
  );
}
