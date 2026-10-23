import type { CSSProperties } from "react";
import type {
  accent,
  feedback,
  line,
  stages,
  statusBorders,
  statusDots,
  statusTints,
  surfaces,
} from "./palette";
import type { controlHeights, gradients, iconSizes, motion, radii, shadows } from "./tokens";

type PaletteColors<T> = { [Key in keyof T]: string };

/** Single list of custom variants; the three MUI interfaces below all derive from it. */
interface CustomTypographyVariants {
  body1Muted: CSSProperties;
  body2Muted: CSSProperties;
  captionMuted: CSSProperties;
  overline: CSSProperties;
  overlineMuted: CSSProperties;
  monoData: CSSProperties;
  authTitle: CSSProperties;
  statValue: CSSProperties;
  statLabel: CSSProperties;
  body1Strong: CSSProperties;
  body2Strong: CSSProperties;
  displayLg: CSSProperties;
  displayMd: CSSProperties;
  docsBody: CSSProperties;
  docsH1: CSSProperties;
  docsH2: CSSProperties;
  docsH3: CSSProperties;
  docsH4: CSSProperties;
}

declare module "@mui/material/styles" {
  interface Palette {
    surfaces: PaletteColors<typeof surfaces>;
    accent: PaletteColors<typeof accent>;
    line: PaletteColors<typeof line>;
    stages: PaletteColors<typeof stages>;
    status: PaletteColors<typeof feedback>;
    statusTints: PaletteColors<typeof statusTints>;
    statusBorders: PaletteColors<typeof statusBorders>;
    statusDots: PaletteColors<typeof statusDots>;
    attention: Palette["primary"];
  }
  interface PaletteOptions {
    surfaces?: PaletteColors<typeof surfaces>;
    accent?: PaletteColors<typeof accent>;
    line?: PaletteColors<typeof line>;
    stages?: PaletteColors<typeof stages>;
    status?: PaletteColors<typeof feedback>;
    statusTints?: PaletteColors<typeof statusTints>;
    statusBorders?: PaletteColors<typeof statusBorders>;
    statusDots?: PaletteColors<typeof statusDots>;
    attention?: PaletteOptions["primary"];
  }

  interface Theme {
    gradients: typeof gradients;
    motion: typeof motion;
    radii: typeof radii;
    shadows_custom: typeof shadows;
    iconSizes: typeof iconSizes;
    controlHeights: typeof controlHeights;
  }
  interface ThemeOptions {
    gradients?: typeof gradients;
    motion?: typeof motion;
    radii?: typeof radii;
    shadows_custom?: typeof shadows;
    iconSizes?: typeof iconSizes;
    controlHeights?: typeof controlHeights;
  }

  interface TypographyVariants extends CustomTypographyVariants {}
  interface TypographyVariantsOptions extends Partial<CustomTypographyVariants> {}

  interface TypeText {
    prose: string;
  }
}

declare module "@mui/material/Chip" {
  interface ChipPropsColorOverrides {
    attention: true;
  }
}

declare module "@mui/material/Alert" {
  interface AlertPropsColorOverrides {
    attention: true;
  }
}

declare module "@mui/material/Badge" {
  interface BadgePropsColorOverrides {
    attention: true;
  }
}

declare module "@mui/material/Typography" {
  interface TypographyPropsVariantOverrides extends Record<keyof CustomTypographyVariants, true> {}
}

declare module "@mui/material/SvgIcon" {
  interface SvgIconPropsSizeOverrides {
    xs: true;
    sm: true;
    md: true;
    lg: true;
    xl: true;
    xxl: true;
    "2xxl": true;
  }
}

declare module "@mui/material/Paper" {
  interface PaperPropsVariantOverrides {
    interactive: true;
    /** Hover-lift + accent glow, for a whole card that is a link. */
    lift: true;
    /** Flame-accent border, for inline CTA cards. */
    accent: true;
    /** Bordered, radius-md surface for inline panels and framed blocks. */
    panel: true;
  }
}
