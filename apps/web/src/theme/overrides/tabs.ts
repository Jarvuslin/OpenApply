import type { Components, Theme } from "@mui/material/styles";

export const tabsOverrides: Components<Theme>["MuiTabs"] = {
  styleOverrides: {
    root: ({ theme }) => ({
      borderBottom: `1px solid ${theme.palette.line.divider}`,
      minHeight: 40,
    }),
    indicator: ({ theme }) => ({
      height: 2,
      backgroundColor: theme.palette.accent.primary,
    }),
  },
};

export const tabOverrides: Components<Theme>["MuiTab"] = {
  styleOverrides: {
    root: ({ theme }) => ({
      textTransform: "none",
      minHeight: 40,
      ...theme.typography.button,
      padding: "10px 16px",
      color: theme.palette.text.secondary,
      "&.Mui-selected": { color: theme.palette.accent.primary },
    }),
  },
};
