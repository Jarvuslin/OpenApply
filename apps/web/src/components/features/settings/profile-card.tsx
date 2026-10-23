"use client";

import type { ReactElement, ReactNode } from "react";
import { Box, Button, Link, Stack, Typography } from "@mui/material";
import { Pencil } from "lucide-react";
import { SectionCard } from "@/components/ui/layout";

/** Label, value, optional link target and an example shown while the value is empty. */
export type ProfileFact = [
  label: string,
  value: string | null | undefined,
  href?: string | null,
  example?: string,
];

interface ProfileCardProps {
  title: string;
  icon: ReactNode;
  description?: string;
  onEdit: () => void;
  /** One list of facts, or several side by side on wide screens with a rule between them. */
  items: ProfileFact[] | ProfileFact[][];
  /** Labels above values instead of beside them. */
  stacked?: boolean;
  /** Stretch to the row so side-by-side cards end together. */
  fullHeight?: boolean;
}

/** A profile section at a glance: facts in columns and one Edit button. */
export function ProfileCard(props: ProfileCardProps): ReactElement {
  const { title, icon, description, onEdit, items, stacked = false, fullHeight = false } = props;
  const columns = (Array.isArray(items[0]?.[0]) ? items : [items]) as ProfileFact[][];
  return (
    <SectionCard
      flush
      fullHeight={fullHeight}
      title={title}
      description={description}
      icon={icon}
      actions={<EditButton onClick={onEdit} />}
    >
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "minmax(0, 1fr)",
            md: `repeat(${columns.length}, minmax(0, 1fr))`,
          },
          flex: 1,
        }}
      >
        {columns.map((facts, index) => (
          <Box
            key={facts.map(([label]) => label).join()}
            component="dl"
            sx={{
              m: 0,
              px: 2.5,
              py: stacked ? 2 : 1.25,
              position: "relative",
              borderTop: { xs: index > 0 ? 1 : 0, md: 0 },
              borderColor: "divider",
              // An inset rule between columns, in the card border colour, that stops short of the edges.
              "&::before": {
                content: '""',
                display: { xs: "none", md: index > 0 ? "block" : "none" },
                position: "absolute",
                left: 0,
                top: 16,
                bottom: 16,
                width: "1px",
                bgcolor: "divider",
              },
              display: "flex",
              flexDirection: "column",
              gap: stacked ? 2 : 0,
            }}
          >
            {facts.map((fact) => (
              <Fact key={fact[0]} fact={fact} stacked={stacked} />
            ))}
          </Box>
        ))}
      </Box>
    </SectionCard>
  );
}

function Fact({ fact, stacked }: { fact: ProfileFact; stacked: boolean }): ReactElement {
  const [label, value, href, example] = fact;
  const shown =
    value && href ? (
      <Link href={href} target="_blank" rel="noopener noreferrer" underline="hover">
        {value}
      </Link>
    ) : (
      value || "Not set"
    );
  return (
    <Stack
      direction={stacked ? "column" : { xs: "column", sm: "row" }}
      spacing={stacked ? 0.5 : { xs: 0.25, sm: 1.5 }}
      sx={{ py: stacked ? 0 : 0.875 }}
    >
      <Typography
        variant={stacked ? "captionMuted" : "body2Muted"}
        component="dt"
        sx={{ width: stacked ? undefined : { sm: 136 }, flexShrink: 0 }}
      >
        {label}
      </Typography>
      <Box component="dd" sx={{ m: 0, flex: 1, minWidth: 0 }}>
        <Typography
          variant={stacked ? "body1" : "body2"}
          sx={{ overflowWrap: "anywhere", color: value ? "text.primary" : "text.disabled" }}
        >
          {shown}
        </Typography>
        {!value && example && (
          <Typography variant="captionMuted" component="p">
            e.g. {example}
          </Typography>
        )}
      </Box>
    </Stack>
  );
}

interface EditButtonProps {
  onClick: () => void;
  label?: string;
}

export function EditButton({ onClick, label = "Edit" }: EditButtonProps): ReactElement {
  return (
    <Button
      size="small"
      variant="outlined"
      startIcon={<Pencil size={13} aria-hidden />}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

interface SectionIntroProps {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  /** A smaller heading for a block inside a tab, such as Education. */
  nested?: boolean;
}

/** A tab or block heading: icon, title, one line of context and an optional action. */
export function SectionIntro(props: SectionIntroProps): ReactElement {
  const { icon, title, description, action, nested = false } = props;
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: "flex-start" }}>
      <Box sx={{ display: "flex", pt: nested ? 0.25 : 0.5, color: "text.primary" }}>{icon}</Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant={nested ? "h4" : "h3"} component="h2">
          {title}
        </Typography>
        <Typography variant="body2Muted">{description}</Typography>
      </Box>
      {action}
    </Stack>
  );
}
