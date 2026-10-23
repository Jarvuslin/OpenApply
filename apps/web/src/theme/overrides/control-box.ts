import type { CSSObject, Theme } from "@mui/material/styles";

/**
 * The box every clickable control shares. Height comes from the token, not from padding: a button
 * has to line up with the input next to it, and padding math drifts with the font size. Spread into
 * Button and ToggleButton so the two cannot diverge.
 */
export function controlBox(theme: Theme): CSSObject {
  return {
    ...theme.typography.button,
    borderRadius: theme.radii.sm,
    paddingInline: 16,
    paddingBlock: 0,
    minHeight: theme.controlHeights.md,
    fontWeight: 500,
    letterSpacing: 0,
    whiteSpace: "nowrap",
    transition: theme.motion.standard,
    "&:focus-visible": { boxShadow: theme.shadows_custom.focus },
  };
}

export function controlBoxSmall(theme: Theme): CSSObject {
  return { paddingInline: 12, minHeight: theme.controlHeights.sm };
}

/** Neutral outlined controls share the input border and hover surface. */
export function outlinedControl(theme: Theme): CSSObject {
  return {
    borderColor: theme.palette.line.border,
    "&:hover": {
      backgroundColor: theme.palette.surfaces.hover,
      borderColor: theme.palette.line.borderHi,
    },
  };
}
