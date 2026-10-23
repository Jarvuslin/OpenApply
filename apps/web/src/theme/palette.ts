// White app, 1px lines, one blue for selection and the main action; pastel pills carry status.
export const surfaces = {
  base: "#FFFFFF",
  card: "#FFFFFF",
  elevated: "#F8F8F9",
  hover: "#F3F4F6",
  inverse: "#18181B",
} as const;
export const accent = { primary: "#2F6BEA", secondary: "#2F6BEA", dark: "#2256C7" } as const;
export const textColors = {
  primary: "#18181B",
  secondary: "#71717A",
  disabled: "#A1A1AA",
  prose: "#3F3F46",
} as const;
// Pill text colours: dark enough to read on their own pastel fill.
export const feedback = {
  neutral: "#52525B",
  error: "#8F1F18",
  success: "#1D5E17",
  info: "#1C3F99",
  warning: "#6B4E00",
  attention: "#7F1D7B",
} as const;
export const statusTints = {
  neutral: "#EEEEF1",
  info: "#C9DAFC",
  success: "#C8F1C0",
  warning: "#FCEDB4",
  error: "#FDD8D6",
  attention: "#F7CDF5",
} as const;
export const statusBorders = {
  neutral: "#D6D6DC",
  info: "#93B3F6",
  success: "#96DC8A",
  warning: "#EFD173",
  error: "#F3A9A4",
  attention: "#E9A2E6",
} as const;
/** Queue worker status dots: one saturated color per state, beside neutral text. */
export const statusDots = {
  active: "#3B6FE0",
  done: "#13805A",
  waiting: "#C27C1A",
  failed: "#D64545",
  neutral: "#9CA3AF",
} as const;
export const line = { divider: "#E7E7EA", border: "#E7E7EA", borderHi: "#D9D9DE" } as const;

export const stages = {
  queued: feedback.neutral,
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
