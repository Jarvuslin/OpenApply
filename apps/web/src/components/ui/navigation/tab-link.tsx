"use client";

import type { ReactElement } from "react";
import { Box } from "@mui/material";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface TabLinkProps {
  href: Route;
  label: string;
}

/** The one interactive leaf of a tab strip: highlights the active route. */
export function TabLink(props: TabLinkProps): ReactElement {
  const { href, label } = props;
  const pathname = usePathname();
  const active = pathname === href;

  return (
    <Box
      component={Link}
      href={href}
      aria-current={active ? "page" : undefined}
      sx={(theme) => ({
        display: "inline-flex",
        alignItems: "center",
        minHeight: theme.controlHeights.md,
        px: 1.5,
        typography: "button",
        textDecoration: "none",
        color: active ? "accent.primary" : "text.secondary",
        // Paints over the strip's inset-shadow divider (shadows render behind children).
        borderBottom: `2px solid ${active ? theme.palette.accent.primary : "transparent"}`,
        transition: `color ${theme.motion.fast}, border-color ${theme.motion.fast}`,
        "&:hover": { color: active ? "accent.primary" : "text.primary" },
        "&:focus-visible": { outline: 0, boxShadow: theme.shadows_custom.focus },
      })}
    >
      {label}
    </Box>
  );
}
