"use client";
import { type ReactElement, Suspense } from "react";
import { NorthEast } from "@mui/icons-material";
import { Box, Button, Divider, Stack, Typography } from "@mui/material";
import NextLink from "next/link";
import { OpenApplyMark } from "@/components/brand/openapply-mark";
import { AccountMenu } from "@/components/features/profile/account-menu";
import { useSession } from "@/hooks/use-auth";
import { FeedbackMenu } from "./feedback-menu";
import { NavGroup } from "./nav-group";
import { APP_TITLE, footerNavGroups, RAIL_WIDTH, visibleNavGroups } from "./shell-config";
export function Rail(): ReactElement {
  const { user } = useSession();
  return (
    <Stack
      component="aside"
      aria-label={APP_TITLE}
      sx={{
        width: RAIL_WIDTH,
        flexShrink: 0,
        height: "100%",
        borderRight: 1,
        borderColor: "divider",
        bgcolor: "surfaces.base",
      }}
    >
      <Stack
        component={NextLink}
        href="/mvp"
        direction="row"
        spacing={1.25}
        sx={{ alignItems: "center", px: 2.5, py: 3, textDecoration: "none", color: "text.primary" }}
      >
        <OpenApplyMark size={28} />
        <Typography variant="h4">OpenApply</Typography>
        <Typography variant="captionMuted">personal</Typography>
      </Stack>
      <Box sx={{ flex: 1, overflowY: "auto" }}>
        <Suspense>
          {visibleNavGroups(user?.role).map((group) => (
            <NavGroup key={group.label} group={group} />
          ))}
        </Suspense>
      </Box>
      <Stack
        spacing={1}
        sx={{
          m: 1.5,
          p: 1.5,
          border: 1,
          borderColor: "divider",
          borderRadius: 10,
          bgcolor: "background.paper",
        }}
      >
        <Typography variant="body2Strong">Your next chapter</Typography>
        <Typography variant="captionMuted">A little less admin. A lot more possibility.</Typography>
        <Button component={NextLink} href="/mvp" size="small" endIcon={<NorthEast fontSize="xs" />}>
          Open workspace
        </Button>
      </Stack>
      <Suspense>
        {visibleNavGroups(user?.role, footerNavGroups).map((group) => (
          <NavGroup key={group.label ?? "settings"} group={group} />
        ))}
      </Suspense>
      <Divider sx={{ mt: 1.5 }} />
      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", p: 1.5 }}>
        <AccountMenu />
        <FeedbackMenu />
      </Stack>
    </Stack>
  );
}
