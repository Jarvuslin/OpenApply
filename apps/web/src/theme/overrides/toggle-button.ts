import type { Components, Theme } from "@mui/material/styles";
import { controlBox, controlBoxSmall, outlinedControl } from "./control-box";

/** Shares the Button's box and outlined shell - the two sit side by side in every filter bar. */
export const toggleButtonOverrides: Components<Theme>["MuiToggleButton"] = {
  styleOverrides: {
    root: ({ theme }) => ({
      ...controlBox(theme),
      ...outlinedControl(theme),
      color: (theme.vars ?? theme).palette.text.secondary,
      textTransform: "none",
      "&.Mui-selected": {
        color: theme.palette.accent.primary,
        borderColor: theme.palette.accent.primary,
        backgroundColor: theme.palette.surfaces.elevated,
        "&:hover": { backgroundColor: theme.palette.surfaces.hover },
      },
    }),
    sizeSmall: ({ theme }) => controlBoxSmall(theme),
  },
};
