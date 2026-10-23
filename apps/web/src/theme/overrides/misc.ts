import { alpha, type Components, type Theme } from "@mui/material/styles";

/**
 * Global colour rules, kept here rather than in globals.css so the palette stays
 * the one source (CssBaseline already paints body's background/text from it).
 */
export const cssBaselineOverrides: Components<Theme>["MuiCssBaseline"] = {
  styleOverrides: (theme) => ({
    "::selection": {
      background: alpha(theme.palette.info.main, 0.18),
      color: theme.palette.text.primary,
    },
    // Mice only: a styled scrollbar is a classic one, and it steals layout width off the right edge.
    // Touch keeps its native overlay bar, which costs nothing and leaves content centred.
    "@media (pointer: fine)": {
      "::-webkit-scrollbar": { width: 10, height: 10 },
      "::-webkit-scrollbar-track": { background: "transparent" },
      "::-webkit-scrollbar-thumb": {
        background: theme.palette.line.border,
        borderRadius: 6,
        border: "2px solid transparent",
        backgroundClip: "padding-box",
      },
      "::-webkit-scrollbar-thumb:hover": {
        background: theme.palette.line.borderHi,
        backgroundClip: "padding-box",
      },
    },
  }),
};

const chipStatus = {
  default: "neutral",
  primary: "neutral",
  secondary: "info",
  info: "info",
  success: "success",
  warning: "warning",
  error: "error",
  attention: "attention",
} as const;

export const chipOverrides: Components<Theme>["MuiChip"] = {
  styleOverrides: {
    root: ({ theme, ownerState }) => {
      const status = chipStatus[ownerState.color ?? "default"];
      return {
        // The design's status pill: pastel fill, a slightly deeper border, dark text.
        fontFamily: theme.typography.fontFamily,
        fontSize: "0.6875rem",
        lineHeight: "14px",
        borderRadius: theme.radii.pill,
        fontWeight: 500,
        height: 20,
        color: theme.palette.status[status],
        backgroundColor: theme.palette.statusTints[status],
        border: `1px solid ${theme.palette.statusBorders[status]}`,
        ...(ownerState.variant === "outlined" && { backgroundColor: theme.palette.surfaces.card }),
        "& .MuiChip-icon, & .MuiChip-deleteIcon": { color: "inherit" },
        "&.MuiChip-clickable:hover": { backgroundColor: theme.palette.surfaces.hover },
      };
    },
    label: { paddingInline: 8 },
  },
};

export const alertOverrides: Components<Theme>["MuiAlert"] = {
  defaultProps: { variant: "standard" },
  styleOverrides: {
    root: ({ theme, ownerState }) => {
      const status = ownerState.color ?? ownerState.severity ?? "success";
      return {
        ...theme.typography.body2,
        borderRadius: theme.radii.md,
        padding: "12px 16px",
        color: theme.palette.text.primary,
        backgroundColor: theme.palette.statusTints[status],
        "& .MuiAlert-icon": { color: theme.palette.status[status] },
      };
    },
    message: { paddingBlock: 2 },
  },
};

export const alertTitleOverrides: Components<Theme>["MuiAlertTitle"] = {
  styleOverrides: { root: ({ theme }) => ({ ...theme.typography.body1Strong, marginBottom: 4 }) },
};

/**
 * Page containers are vertical stacks that rely on `gap` for spacing between the
 * header and content cards.
 */
export const containerOverrides: Components<Theme>["MuiContainer"] = {
  styleOverrides: {
    root: ({ theme }) => ({
      display: "flex",
      flexDirection: "column",
      [theme.breakpoints.up("sm")]: {
        paddingLeft: theme.spacing(5),
        paddingRight: theme.spacing(5),
      },
      "&.MuiContainer-maxWidthLg": { maxWidth: 1208 },
      // Tighter than MUI's 16px: the gutter stacks with the padding of the cards nested inside.
      [theme.breakpoints.down("sm")]: {
        paddingLeft: theme.spacing(1.5),
        paddingRight: theme.spacing(1.5),
      },
    }),
  },
};

export const svgIconOverrides: Components<Theme>["MuiSvgIcon"] = {
  styleOverrides: {
    root: ({ ownerState }) => ({
      ...(ownerState.fontSize === "xs" && { fontSize: "0.875rem" }),
      ...(ownerState.fontSize === "sm" && { fontSize: "1rem" }),
      ...(ownerState.fontSize === "md" && { fontSize: "1.125rem" }),
      ...(ownerState.fontSize === "lg" && { fontSize: "1.25rem" }),
      ...(ownerState.fontSize === "xl" && { fontSize: "1.5rem" }),
      ...(ownerState.fontSize === "xxl" && { fontSize: "1.75rem" }),
      ...(ownerState.fontSize === "2xxl" && { fontSize: "2rem" }),
    }),
  },
};

export const paperOverrides: Components<Theme>["MuiPaper"] = {
  defaultProps: { elevation: 0 },
  styleOverrides: {
    root: ({ theme }) => ({
      backgroundImage: "none",
      backgroundColor: theme.palette.surfaces.card,
    }),
  },
  variants: [
    {
      props: { variant: "panel" },
      style: ({ theme }) => ({
        border: `1px solid ${theme.palette.line.border}`,
        borderRadius: theme.radii.md,
      }),
    },
  ],
};

/**
 * `spacing` as a real flex `gap`, not MUI's default `margin-left` on every child but the first.
 * Margins survive wrapping, so any `flexWrap` row indents its second line by one gap.
 */
export const skeletonOverrides: Components<Theme>["MuiSkeleton"] = {
  styleOverrides: {
    // `shape.borderRadius` is pinned to 1 so sx radii read as px, which leaves MUI's
    // "rounded" skeleton a 1px square. Placeholders stand in for cards, so match those.
    rounded: ({ theme }) => ({ borderRadius: theme.radii.md }),
  },
};

export const stackOverrides: Components<Theme>["MuiStack"] = {
  defaultProps: { useFlexGap: true },
};

export const typographyOverrides: Components<Theme>["MuiTypography"] = {
  defaultProps: {
    variantMapping: {
      body1Muted: "p",
      body2Muted: "p",
      captionMuted: "span",
      overline: "span",
      overlineMuted: "span",
      body1Strong: "p",
      body2Strong: "p",
      monoData: "span",
      authTitle: "h1",
      displayLg: "h1",
      displayMd: "h2",
      docsBody: "p",
      docsH1: "h1",
      docsH2: "h2",
      docsH3: "h3",
      docsH4: "h4",
    },
  },
};
