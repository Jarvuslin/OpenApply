"use client";
import type { ReactElement } from "react";
import { Stack, Typography } from "@mui/material";
import { NavItem } from "./nav-item";
import type { NavGroup as NavGroupType } from "./shell-config";

interface NavGroupProps {
  group: NavGroupType;
}
export function NavGroup({ group }: NavGroupProps): ReactElement {
  return (
    <Stack
      spacing={0.25}
      sx={{ px: 1.5, width: "100%" }}
      role={group.label ? "group" : undefined}
      aria-label={group.label}
    >
      {group.label && (
        <Typography variant="captionMuted" sx={{ px: 1.25, pt: 1.5, pb: 0.75 }}>
          {group.label}
        </Typography>
      )}
      {group.items.map((item) => (
        <NavItem key={item.href} item={item} />
      ))}
    </Stack>
  );
}
