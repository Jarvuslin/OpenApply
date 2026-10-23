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
      "&.Mui-disabled": {
        color: theme.palette.text.disabled,
        backgroundColor: theme.palette.surfaces.elevated,
      },
    }),
    outlined: ({ theme, ownerState }) => ({
      ...outlinedControl(theme),
      color: ownerState.color === "error" ? theme.palette.error.main : theme.palette.text.primary,
      ...(ownerState.color === "error" && {
        borderColor: theme.palette.error.main,
        "&:hover": {
          borderColor: theme.palette.error.main,
          backgroundColor: theme.palette.statusTints.error,
        },
      }),
    }),
    text: ({ theme, ownerState }) => ({
      color: ownerState.color === "error" ? theme.palette.error.main : theme.palette.text.secondary,
      "&:hover": {
        color: ownerState.color === "error" ? theme.palette.error.main : theme.palette.text.primary,
        backgroundColor:
          ownerState.color === "error"
            ? theme.palette.statusTints.error
            : theme.palette.surfaces.elevated,
      },
    }),
  },
};
