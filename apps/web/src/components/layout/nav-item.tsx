"use client";
import type { ReactElement } from "react";
import { Box, Typography } from "@mui/material";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavCount } from "./nav-badge";
import { isNavEntryActive, type NavItem as NavItemType } from "./shell-config";

interface NavItemProps {
  item: NavItemType;
}
export function NavItem({ item }: NavItemProps): ReactElement {
  const active = isNavEntryActive(usePathname(), item);
  const Icon = item.icon;
  return (
    <Box
      component={Link}
      href={item.href as Route}
      aria-current={active ? "page" : undefined}
      sx={(theme) => ({
        display: "flex",
        alignItems: "center",
        gap: 1.25,
        px: 1.25,
        height: 34,
        width: "100%",
        borderRadius: theme.radii.md,
        color: active ? "primary.contrastText" : "text.prose",
        backgroundColor: active ? "primary.main" : "transparent",
        textDecoration: "none",
        transition: theme.motion.fast,
        "&:hover": { backgroundColor: active ? "primary.main" : "surfaces.hover" },
        "&:focus-visible": {
          outline: "2px solid",
          outlineColor: "primary.main",
          outlineOffset: 2,
        },
      })}
    >
      <Icon size={18} strokeWidth={1.75} aria-hidden />
      <Typography variant="body2" sx={{ flex: 1, fontWeight: active ? 500 : 400 }}>
        {item.label}
      </Typography>
      <NavCount badge={item.badge} active={active} />
    </Box>
  );
}
