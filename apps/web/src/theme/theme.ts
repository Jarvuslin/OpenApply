import { createTheme } from "@mui/material/styles";
import { componentOverrides } from "./overrides";
import {
  accent,
  feedback,
  line,
  stages,
  statusBorders,
  statusDots,
  statusTints,
  surfaces,
  textColors,
} from "./palette";
import { controlHeights, gradients, iconSizes, motion, radii, shadows } from "./tokens";
import { typography } from "./typography";

export const theme = createTheme({
  cssVariables: true,
  palette: {
    mode: "light",
    primary: { main: accent.primary, contrastText: "#FFFFFF" },
    secondary: { main: accent.secondary, contrastText: "#FFFFFF" },
    warning: { main: feedback.warning },
    error: { main: feedback.error },
    success: { main: feedback.success },
    info: { main: feedback.info },
    attention: { main: feedback.attention },
    background: { default: surfaces.base, paper: surfaces.card },
    text: {
      primary: textColors.primary,
      secondary: textColors.secondary,
      disabled: textColors.disabled,
      prose: textColors.prose,
    },
    divider: line.divider,
    surfaces,
    accent,
    line,
    stages,
    status: feedback,
    statusTints,
    statusBorders,
    statusDots,
    action: {
      hover: surfaces.hover,
      selected: surfaces.elevated,
      disabled: textColors.disabled,
      disabledBackground: surfaces.elevated,
      focus: statusTints.info,
    },
  },
  // Keep the sx multiplier at 1 so a `radii` token in sx means that many px, exactly as in
  // styleOverrides. Component overrides pin the real radii (card md, dialog lg) explicitly.
  shape: { borderRadius: 1 },
  typography,
  gradients,
  motion,
  radii,
  shadows_custom: shadows,
  iconSizes,
  controlHeights,
  components: componentOverrides,
});
