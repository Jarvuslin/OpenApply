import type { TypographyVariantsOptions } from "@mui/material/styles";
import { textColors } from "./palette";

export const fontFamilies = {
  body: 'var(--font-inter), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  display: "var(--font-inter), ui-sans-serif, system-ui, sans-serif",
  wordmark: 'var(--font-wordmark), "Libre Caslon Text", Georgia, serif',
  mono: "var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

const displayStretch = "100%";

/** /docs prose metrics; `docsH4` reuses the size so an h4 sits flush with the prose around it. */
const docsBody = {
  fontFamily: fontFamilies.body,
  fontSize: "0.9375rem",
  lineHeight: 1.7,
  color: textColors.prose,
} as const;

const docsHeading = {
  fontFamily: fontFamilies.body,
  fontWeight: 600,
} as const;

// Design scale: body large 14/20, body 13/18, small 12/16, tiny 11/14.
const body = { fontFamily: fontFamilies.body, fontSize: "0.875rem", lineHeight: "20px" };
const small = {
  fontFamily: fontFamilies.body,
  fontSize: "0.8125rem",
  lineHeight: "18px",
  letterSpacing: "-0.003em",
};
const caption = { fontFamily: fontFamilies.body, fontSize: "0.75rem", lineHeight: "16px" };
// An eyebrow line, as the design sets them: small and medium, not shouted in capitals.
const overline = {
  fontFamily: fontFamilies.body,
  fontSize: "0.75rem",
  lineHeight: "16px",
  fontWeight: 500,
  letterSpacing: 0,
  textTransform: "none",
} as const;
const monoData = {
  fontFamily: fontFamilies.mono,
  fontSize: "0.75rem",
  lineHeight: "16px",
  fontWeight: 400,
  fontVariantNumeric: "tabular-nums",
} as const;

export const typography: TypographyVariantsOptions = {
  fontFamily: fontFamilies.body,
  fontSize: 14,
  fontWeightRegular: 400,
  fontWeightMedium: 500,
  fontWeightBold: 600,
  h1: {
    fontFamily: fontFamilies.display,
    fontWeight: 600,
    fontSize: "1.625rem",
    lineHeight: "32px",
    letterSpacing: "-0.02em",
  },
  h2: {
    fontFamily: fontFamilies.display,
    fontWeight: 600,
    fontSize: "1.625rem",
    lineHeight: "32px",
    letterSpacing: "-0.02em",
  },
  h3: {
    fontFamily: fontFamilies.display,
    fontWeight: 600,
    fontSize: "1.125rem",
    lineHeight: "24px",
    letterSpacing: "-0.01em",
  },
  h4: {
    fontFamily: fontFamilies.display,
    fontWeight: 600,
    fontSize: "1rem",
    lineHeight: "22px",
    letterSpacing: "-0.01em",
  },
  h5: {
    fontFamily: fontFamilies.body,
    fontWeight: 600,
    fontSize: "1rem",
    lineHeight: "22px",
    letterSpacing: "-0.01em",
  },
  h6: {
    fontFamily: fontFamilies.body,
    fontWeight: 600,
    fontSize: "0.9375rem",
    lineHeight: "20px",
    letterSpacing: "-0.005em",
  },
  body1: body,
  body2: small,
  button: {
    fontFamily: fontFamilies.body,
    textTransform: "none",
    fontWeight: 500,
    fontSize: "0.8125rem",
    lineHeight: "18px",
    letterSpacing: 0,
  },
  caption,
  overline,
  overlineMuted: { ...overline, color: textColors.secondary },
  body1Muted: { ...body, color: textColors.secondary },
  body2Muted: { ...small, color: textColors.secondary },
  captionMuted: { ...caption, color: textColors.secondary },
  monoData,
  authTitle: {
    fontFamily: fontFamilies.body,
    fontSize: "1.5rem",
    lineHeight: "30px",
    fontWeight: 600,
    letterSpacing: "-0.02em",
  },
  statValue: {
    fontFamily: fontFamilies.body,
    fontWeight: 600,
    fontSize: "1.5rem",
    lineHeight: "30px",
    letterSpacing: "-0.015em",
    fontVariantNumeric: "tabular-nums",
  },
  statLabel: {
    fontFamily: fontFamilies.body,
    fontSize: "0.75rem",
    lineHeight: "16px",
    fontWeight: 500,
    color: textColors.secondary,
  },
  body1Strong: { ...body, fontWeight: 500 },
  body2Strong: { ...small, fontWeight: 500 },
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
