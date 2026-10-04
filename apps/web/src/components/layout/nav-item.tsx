"use client";
import type { ReactElement } from "react";
import { Box, Typography } from "@mui/material";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavBadge } from "./nav-badge";
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
        py: 1,
        width: "100%",
        borderRadius: theme.radii.sm,
        color: active ? "text.primary" : "text.secondary",
        backgroundColor: active ? "surfaces.hover" : "transparent",
        textDecoration: "none",
        transition: theme.motion.fast,
        "&:hover": { backgroundColor: "surfaces.elevated", color: "text.primary" },
        "&:focus-visible": {
          outline: "2px solid",
          outlineColor: "secondary.main",
          outlineOffset: 2,
        },
      })}
    >
      <NavBadge badge={item.badge}>
        <Icon fontSize="sm" />
      </NavBadge>
      <Typography variant={active ? "body1Strong" : "body1"}>{item.label}</Typography>
    </Box>
  );
}
