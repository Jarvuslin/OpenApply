import type { Components, Theme } from "@mui/material/styles";
import NextLink from "next/link";

/**
 * `component: NextLink` lives here, not at each call site: the theme is built inside the client
 * ThemeProvider, so the component *function* never crosses the RSC boundary as a prop and a server
 * component can link with a plain `href`. Absolute URLs still render as plain anchors.
 */
export const linkOverrides: Components<Theme>["MuiLink"] = {
  defaultProps: { underline: "hover", component: NextLink },
  styleOverrides: {
    root: ({ theme }) => ({
      color: theme.palette.info.main,
      fontWeight: 500,
    }),
  },
};

/** Same, for everything built on ButtonBase (Button, CardActionArea, IconButton, Tab). */
export const buttonBaseOverrides: Components<Theme>["MuiButtonBase"] = {
  defaultProps: { LinkComponent: NextLink },
  styleOverrides: {
    root: ({ theme }) => ({
      "&.Mui-focusVisible": { outline: `2px solid ${theme.palette.info.main}`, outlineOffset: 2 },
    }),
  },
};
