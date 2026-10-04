import type { Components, Theme } from "@mui/material/styles";
import { controlBox, controlBoxSmall, outlinedControl } from "./control-box";
export const buttonOverrides: Components<Theme>["MuiButton"] = {
  defaultProps: { disableElevation: true },
  styleOverrides: {
    root: ({ theme }) => ({ position: "relative", ...controlBox(theme) }),
    sizeSmall: ({ theme }) => controlBoxSmall(theme),
    contained: ({ theme }) => ({
      backgroundColor: theme.palette.accent.primary,
      color: (theme.vars ?? theme).palette.primary.contrastText,
      boxShadow: "none",
      "&:hover": { backgroundColor: theme.palette.accent.dark, boxShadow: "none" },
    }),
    outlined: ({ theme }) => ({
      ...outlinedControl(theme),
      color: (theme.vars ?? theme).palette.text.primary,
    }),
    text: ({ theme }) => ({
      color: (theme.vars ?? theme).palette.text.secondary,
      "&:hover": {
        color: theme.palette.text.primary,
        backgroundColor: theme.palette.surfaces.elevated,
      },
    }),
  },
};
