import type { Components, Theme } from "@mui/material/styles";

/** Every badge in the app is an attention count on a nav icon; zero renders nothing. */
export const badgeOverrides: Components<Theme>["MuiBadge"] = {
  defaultProps: { color: "attention", overlap: "circular", max: 99 },
  styleOverrides: {
    badge: ({ theme, ownerState }) => ({
      ...theme.typography.caption,
      fontWeight: 500,
      ...(ownerState.color === "attention" && {
        color: theme.palette.attention.main,
        backgroundColor: theme.palette.statusTints.attention,
      }),
    }),
  },
};
