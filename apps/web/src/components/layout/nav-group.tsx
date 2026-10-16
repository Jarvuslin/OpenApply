"use client";
import type { ReactElement } from "react";
import { Stack } from "@mui/material";
import { NavItem } from "./nav-item";
import type { NavGroup as NavGroupType } from "./shell-config";

interface NavGroupProps {
  group: NavGroupType;
}
export function NavGroup({ group }: NavGroupProps): ReactElement {
  return (
    <Stack spacing={0.25} sx={{ px: 2, width: "100%" }}>
      {group.items.map((item) => (
        <NavItem key={item.href} item={item} />
      ))}
    </Stack>
  );
}
