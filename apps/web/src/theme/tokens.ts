import { alpha } from "@mui/material/styles";
import { accent, feedback } from "./palette";

// Lighter flame tints used only inside these gradients - no equivalent in palette.ts.
const flameLight = "#FF8A5C";
const flameMid = "#FF7A4D";

export const gradients = {
  primary: `linear-gradient(135deg, ${flameLight}, ${accent.primary})`,
  reversed: `linear-gradient(135deg, ${flameMid}, ${accent.dark})`,
  orb: `conic-gradient(from 200deg, ${accent.primary}, ${feedback.warning}, ${accent.secondary}, ${accent.primary})`,
} as const;

export const motion = {
  fast: "160ms cubic-bezier(0.3,0.7,0.2,1)",
  standard: "240ms cubic-bezier(0.2,0.8,0.2,1)",
  expressive: "320ms cubic-bezier(0.2,0.8,0.2,1)",
} as const;

export const shadows = {
  sm: "none",
  md: "0 4px 16px rgba(25,30,25,0.06)",
  lg: "0 16px 48px rgba(25,30,25,0.12)",
  focus: `0 0 0 2px ${alpha(accent.primary, 0.14)}`,
} as const;

export const radii = {
  xs: 4,
  sm: 7,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

/**
 * The two heights every input, button and toggle snaps to, so a filter row lines up without
 * per-call-site `sx`. `md` is what MUI's `size="small"` outlined input already measures at our
 * 13px body font - the rest are pinned to it.
 */
export const controlHeights = {
  sm: 32,
  md: 38,
} as const;

export const iconSizes = {
  xs: 14,
  sm: 16,
  md: 18,
  lg: 20,
  xl: 24,
  xxl: 28,
  "2xxl": 32,
} as const;

export type IconSizeToken = keyof typeof iconSizes;
