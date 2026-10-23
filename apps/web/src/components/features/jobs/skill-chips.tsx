import type { ReactNode } from "react";
import { Box, Link } from "@mui/material";
import { serializeTechParam } from "@openapply/contracts/job-listing";
import { fontFamilies, motion, radii } from "@/theme";
import { jobsHref } from "./jobs-href";

/** Mono pill, matching the board strip on the landing page - the agent's machine voice. */
const skillChipSx = {
  fontFamily: fontFamilies.mono,
  fontSize: "0.7rem",
  whiteSpace: "nowrap",
  paddingInline: 1,
  paddingBlock: 0.25,
  borderRadius: radii.pill,
  color: "text.secondary",
  border: 1,
  borderColor: "line.border",
  backgroundColor: "surfaces.elevated",
} as const;

// The raw token, not an `sx` theme callback: this renders in a server component, and a function
// cannot cross the RSC boundary into MUI's client Link.
const linkedChipSx = {
  ...skillChipSx,
  transition: motion.fast,
  "&:hover": { color: "accent.primary", borderColor: "accent.primary" },
} as const;

interface SkillChipsProps {
  skills: readonly string[];
  /** Cap for dense grids; omit to show them all. */
  max?: number;
  /**
   * Make each chip a link into `/jobs?tech=…`. Never set this inside a JobCard - the whole card is
   * already one anchor, and an anchor cannot nest.
   */
  linked?: boolean;
}

export function SkillChips(props: SkillChipsProps): ReactNode {
  const { skills, max, linked = false } = props;
  if (skills.length === 0) {
    return null;
  }

  const shown = max ? skills.slice(0, max) : skills;
  const overflow = skills.length - shown.length;

  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
      {shown.map((item) => (
        <Box
          key={item}
          component={linked ? Link : "span"}
          {...(linked && {
            href: jobsHref(new URLSearchParams({ tech: serializeTechParam([item]) })),
            underline: "none",
          })}
          sx={linked ? linkedChipSx : skillChipSx}
        >
          {item}
        </Box>
      ))}
      {overflow > 0 && (
        <Box component="span" sx={skillChipSx}>
          +{overflow}
        </Box>
      )}
    </Box>
  );
}
