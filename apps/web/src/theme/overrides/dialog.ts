import type { Components, Theme } from "@mui/material/styles";

export const dialogOverrides: Components<Theme>["MuiDialog"] = {
  styleOverrides: {
    paper: ({ theme }) => ({
      borderRadius: theme.radii.lg,
      boxShadow: theme.shadows_custom.lg,
      backgroundColor: theme.palette.surfaces.card,
    }),
  },
};

export const dialogTitleOverrides: Components<Theme>["MuiDialogTitle"] = {
  styleOverrides: { root: ({ theme }) => ({ ...theme.typography.h4, padding: "16px 24px" }) },
};

export const dialogContentOverrides: Components<Theme>["MuiDialogContent"] = {
  // The header has its own rule, so content always starts with breathing room below it.
  styleOverrides: {
    root: { padding: "20px 24px", ".MuiDialogTitle-root + &": { paddingTop: 20 } },
  },
};

export const dialogActionsOverrides: Components<Theme>["MuiDialogActions"] = {
  styleOverrides: {
    root: ({ theme }) => ({
      padding: "14px 24px",
      gap: 8,
      borderTop: `1px solid ${theme.palette.divider}`,
    }),
  },
};

export const backdropOverrides: Components<Theme>["MuiBackdrop"] = {
  styleOverrides: {
    // Menus and popovers use an invisible backdrop; only dialogs dim and blur the page.
    root: {
      "&:not(.MuiBackdrop-invisible)": {
        backgroundColor: "rgba(8,8,7,0.6)",
        backdropFilter: "blur(3px)",
      },
    },
  },
};
