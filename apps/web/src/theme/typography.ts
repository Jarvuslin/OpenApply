import type { TypographyVariantsOptions } from "@mui/material/styles";
import { line, surfaces, textColors } from "./palette";
import { radii } from "./tokens";

export const fontFamilies = {
  body: 'var(--font-archivo), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  display: "var(--font-archivo), ui-sans-serif, system-ui, sans-serif",
  mono: "var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

// The display role is Archivo widened to its expanded width axis (athletic headers).
const displayStretch = "100%";

/** /docs prose metrics; `docsH4` reuses the size so an h4 sits flush with the prose around it. */
const docsBody = {
  fontFamily: fontFamilies.body,
  fontSize: "0.9375rem",
  lineHeight: 1.7,
  color: textColors.prose,
} as const;

/** Skips the expanded display width: that marketing voice at every /docs section break shouts. */
const docsHeading = {
  fontFamily: fontFamilies.body,
  fontWeight: 600,
} as const;

export const typography: TypographyVariantsOptions = {
  fontFamily: fontFamilies.body,
  h1: {
    fontFamily: fontFamilies.display,
    fontStretch: displayStretch,
    fontWeight: 600,
    fontSize: "2.25rem",
    lineHeight: 1.05,
    letterSpacing: "-0.025em",
  },
  h2: {
    fontFamily: fontFamilies.display,
    fontStretch: displayStretch,
    fontWeight: 600,
    fontSize: "1.75rem",
    lineHeight: 1.15,
    letterSpacing: "-0.02em",
  },
  h3: {
    fontFamily: fontFamilies.display,
    fontStretch: displayStretch,
    fontWeight: 600,
    fontSize: "1.25rem",
    lineHeight: 1.25,
    letterSpacing: "-0.01em",
  },
  h4: {
    fontFamily: fontFamilies.display,
    fontStretch: displayStretch,
    fontWeight: 600,
    fontSize: "1.0625rem",
    lineHeight: 1.3,
    letterSpacing: "-0.005em",
  },
  h5: {
    fontFamily: fontFamilies.body,
    fontWeight: 500,
    fontSize: "0.9375rem",
    lineHeight: 1.35,
  },
  h6: {
    fontFamily: fontFamilies.body,
    fontWeight: 500,
    fontSize: "0.8125rem",
    lineHeight: 1.4,
  },
  body1: { fontFamily: fontFamilies.body, fontSize: "0.8125rem", lineHeight: 1.55 },
  body2: { fontFamily: fontFamilies.body, fontSize: "0.75rem", lineHeight: 1.5 },
  button: {
    fontFamily: fontFamilies.body,
    textTransform: "none",
    fontWeight: 500,
    fontSize: "0.8125rem",
    letterSpacing: 0,
  },
  caption: {
    fontFamily: fontFamilies.body,
    fontSize: "0.6875rem",
    letterSpacing: "0",
  },
  overline: {
    fontFamily: fontFamilies.body,
    fontSize: "0.6875rem",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    lineHeight: 1,
    fontWeight: 600,
  },
  overlineMuted: {
    fontFamily: fontFamilies.body,
    fontSize: "0.6875rem",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    lineHeight: 1,
    fontWeight: 600,
    color: textColors.secondary,
  },
  body1Muted: {
    fontFamily: fontFamilies.body,
    fontSize: "0.8125rem",
    lineHeight: 1.55,
    color: textColors.secondary,
  },
  body2Muted: {
    fontFamily: fontFamilies.body,
    fontSize: "0.75rem",
    lineHeight: 1.5,
    color: textColors.secondary,
  },
  captionMuted: {
    fontFamily: fontFamilies.body,
    fontSize: "0.6875rem",
    letterSpacing: "0",
    color: textColors.secondary,
  },
  // Outlined mono pill. Callers set `fontSize` - ring labels run smaller than board chips.
  monoChip: {
    fontFamily: fontFamilies.mono,
    fontSize: "0.75rem",
    lineHeight: 1.55,
    display: "inline-block",
    whiteSpace: "nowrap",
    padding: "4px 10px",
    borderRadius: radii.pill,
    color: textColors.secondary,
    border: `1px solid ${line.border}`,
    backgroundColor: surfaces.elevated,
  },
  statValue: {
    fontFamily: fontFamilies.mono,
    fontWeight: 600,
    fontSize: "1.5rem",
    lineHeight: 1.1,
    letterSpacing: "-0.02em",
    fontVariantNumeric: "tabular-nums",
  },
  statLabel: {
    fontFamily: fontFamilies.body,
    fontSize: "0.625rem",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    lineHeight: 1,
    fontWeight: 600,
    color: textColors.secondary,
  },
  body1Strong: {
    fontFamily: fontFamilies.body,
    fontSize: "0.8125rem",
    lineHeight: 1.55,
    fontWeight: 600,
  },
  body2Strong: {
    fontFamily: fontFamilies.body,
    fontSize: "0.75rem",
    lineHeight: 1.5,
    fontWeight: 600,
  },
  displayLg: {
    fontFamily: fontFamilies.display,
    fontStretch: displayStretch,
    fontWeight: 600,
    // Plain clamp() keeps this out of responsiveFontSizes; bounds track hero.tsx's h1 (2rem→2.9rem).
    fontSize: "clamp(2rem, 1.4rem + 2.4vw, 2.9rem)",
    lineHeight: 1.1,
    letterSpacing: "-0.025em",
  },
  displayMd: {
    fontFamily: fontFamilies.display,
    fontStretch: displayStretch,
    fontWeight: 600,
    // Min tracks job-detail.tsx's 1.75rem heading; max matches the cta-band h2 ceiling.
    fontSize: "clamp(1.75rem, 1.3rem + 2vw, 2.5rem)",
    lineHeight: 1.15,
    letterSpacing: "-0.02em",
  },
  // Prose for /docs
  docsBody,
  docsH1: {
    ...docsHeading,
    fontWeight: 600,
    fontSize: "1.625rem",
    lineHeight: 1.25,
    letterSpacing: "-0.015em",
  },
  docsH2: { ...docsHeading, fontSize: "1.1875rem", lineHeight: 1.35, letterSpacing: "-0.01em" },
  docsH3: { ...docsHeading, fontSize: "1rem", lineHeight: 1.4 },
  docsH4: { ...docsHeading, fontSize: docsBody.fontSize, lineHeight: 1.5 },
};
