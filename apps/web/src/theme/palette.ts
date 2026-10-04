// A quiet paper workspace; colour is reserved for meaningful status.
export const surfaces = {
  base: "#FAFAF9",
  card: "#FFFFFF",
  elevated: "#F3F3F1",
  hover: "#EDEDEB",
} as const;
export const accent = { primary: "#202120", secondary: "#3669C9", dark: "#3B3D3B" } as const;
export const textColors = {
  primary: "#252725",
  secondary: "#666A66",
  disabled: "#8A8E89",
  prose: "#464A46",
} as const;
export const feedback = {
  error: "#BF4141",
  success: "#27815B",
  info: "#3669C9",
  warning: "#A5681D",
} as const;
export const line = { divider: "#EAECE7", border: "#DDE0DA", borderHi: "#BEC4BB" } as const;
export const stages = {
  queued: "#7B827B",
  applying: accent.secondary,
  submitted: feedback.success,
  interviewing: feedback.warning,
  rejected: feedback.error,
} as const;
export const editorial = {
  paper: "#FFFFFF",
  ink: textColors.primary,
  thrust: accent.secondary,
  flame: "#E86942",
  amber: feedback.warning,
} as const;
