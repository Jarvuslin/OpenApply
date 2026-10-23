"use client";

import type { ComponentProps, ReactElement, ReactNode } from "react";
import { Box, Divider, IconButton, Radio, Stack, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { Check, EllipsisVertical } from "lucide-react";
import { DropdownMenu, type DropdownMenuItem } from "@/components/ui/feedback";
import { formatRelativeTime } from "@/utils/format";

type Tone = "primary" | "success";

interface IconTileProps {
  tone: Tone;
  children: ReactNode;
}

function IconTile({ tone, children }: IconTileProps): ReactElement {
  return (
    <Box
      aria-hidden
      sx={(theme) => ({
        width: 40,
        height: 40,
        flexShrink: 0,
        display: "grid",
        placeItems: "center",
        borderRadius: theme.radii.control,
        color: `${tone}.main`,
        bgcolor: alpha(theme.palette[tone].main, 0.08),
      })}
    >
      {children}
    </Box>
  );
}

interface CardMetaProps {
  time?: string | Date;
  menu?: DropdownMenuItem[];
}

function CardMeta({ time, menu }: CardMetaProps): ReactElement {
  return (
    <>
      {time && (
        <Typography variant="body1Muted" sx={{ flexShrink: 0, whiteSpace: "nowrap" }}>
          {formatRelativeTime(time)} ago
        </Typography>
      )}
      {menu?.some((item) => item.show !== false) && (
        <DropdownMenu
          trigger={({ onOpen }) => (
            <IconButton size="small" aria-label="More actions" onClick={onOpen} sx={{ mr: -0.5 }}>
              <EllipsisVertical size={18} aria-hidden />
            </IconButton>
          )}
          items={menu}
        />
      )}
    </>
  );
}

type SurfaceProps = Omit<ComponentProps<typeof Stack>, "title">;

function CardSurface({ sx, ...rest }: SurfaceProps): ReactElement {
  return (
    <Stack
      component="article"
      {...rest}
      sx={[
        (theme) => ({
          p: 3,
          border: 1,
          borderColor: "line.border",
          borderRadius: theme.radii.card,
          bgcolor: "background.paper",
          boxShadow: theme.shadows_custom.md,
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    />
  );
}

interface QuestionCardFrameProps extends SurfaceProps {
  icon: ReactNode;
  /** The job or subject line beside the icon, e.g. "Frontend Developer · Shopify". */
  subject: ReactNode;
  time?: string | Date;
  menu?: DropdownMenuItem[];
  /** Buttons under the divider; omit for a card with nothing to send. */
  footer?: ReactNode;
}

/** The Needs you card from the design system: icon, subject and time, body, divider, actions. */
export function QuestionCardFrame(props: QuestionCardFrameProps): ReactElement {
  const { icon, subject, time, menu, footer, children, ...rest } = props;
  return (
    <CardSurface spacing={2.5} {...rest}>
      <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
        <IconTile tone="primary">{icon}</IconTile>
        <Typography variant="h5" component="p" sx={{ flex: 1, minWidth: 0 }}>
          {subject}
        </Typography>
        <CardMeta time={time} menu={menu} />
      </Stack>
      {children}
      {footer && (
        <>
          <Divider />
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap", rowGap: 1.5 }}
          >
            {footer}
          </Stack>
        </>
      )}
    </CardSurface>
  );
}

interface QuestionHeadingProps {
  id: string;
  prompt: ReactNode;
  detail?: ReactNode;
}

export function QuestionHeading({ id, prompt, detail }: QuestionHeadingProps): ReactElement {
  return (
    <Stack spacing={1}>
      <Typography id={id} variant="h3">
        {prompt}
      </Typography>
      {detail && (
        <Typography variant="body1Muted" sx={{ whiteSpace: "pre-wrap" }}>
          {detail}
        </Typography>
      )}
    </Stack>
  );
}

interface ChoiceRowProps {
  label: ReactNode;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/** One full-width answer row; a stack of these replaces a radio group in the card. */
export function ChoiceRow({ label, selected, disabled, onSelect }: ChoiceRowProps): ReactElement {
  return (
    <Box
      component="label"
      sx={(theme) => ({
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        minHeight: 56,
        px: 2,
        borderRadius: theme.radii.control,
        border: 1,
        borderColor: selected ? "primary.main" : "line.border",
        boxShadow: selected ? `inset 0 0 0 0.5px ${theme.palette.primary.main}` : "none",
        bgcolor: selected ? alpha(theme.palette.primary.main, 0.03) : "background.paper",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transition: theme.motion.fast,
        "&:hover": disabled || selected ? {} : { borderColor: "line.borderHi" },
      })}
    >
      <Radio
        size="small"
        checked={selected}
        disabled={disabled}
        onChange={onSelect}
        sx={{ p: 0, color: "line.borderHi", "&.Mui-checked": { color: "primary.main" } }}
      />
      <Typography variant="body1Strong" sx={{ flex: 1, minWidth: 0 }}>
        {label}
      </Typography>
    </Box>
  );
}

interface AnsweredQuestionCardProps extends SurfaceProps {
  subject: ReactNode;
  /** The question and the answer given, e.g. "Allowed to work in Canada → Yes". */
  summary: ReactNode;
  note?: ReactNode;
  time?: string | Date;
  menu?: DropdownMenuItem[];
  action?: ReactNode;
}

export function AnsweredQuestionCard(props: AnsweredQuestionCardProps): ReactElement {
  const { subject, summary, note, time, menu, action, ...rest } = props;
  return (
    <CardSurface direction="row" spacing={2} {...rest}>
      <IconTile tone="success">
        <Check size={22} aria-hidden />
      </IconTile>
      <Stack spacing={0.75} sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <Box
            sx={(theme) => ({
              px: 1.5,
              py: 0.5,
              borderRadius: theme.radii.pill,
              bgcolor: alpha(theme.palette.success.main, 0.1),
            })}
          >
            <Typography variant="body2Strong" sx={{ color: "success.main" }}>
              Answered
            </Typography>
          </Box>
          <Box sx={{ flex: 1 }} />
          <CardMeta time={time} menu={menu} />
        </Stack>
        <Typography variant="body1">{subject}</Typography>
        <Stack
          direction="row"
          spacing={2}
          sx={{ alignItems: "center", pt: 1.75, flexWrap: "wrap", rowGap: 1.5 }}
        >
          <Stack spacing={0.75} sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h5" component="p">
              {summary}
            </Typography>
            {note && <Typography variant="body1Muted">{note}</Typography>}
          </Stack>
          {action}
        </Stack>
      </Stack>
    </CardSurface>
  );
}
