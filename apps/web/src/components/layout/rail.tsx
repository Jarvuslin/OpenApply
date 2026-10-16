"use client";
import { type ReactElement, Suspense } from "react";
import { Box, Stack, Typography } from "@mui/material";
import NextLink from "next/link";
import { AccountMenu } from "@/components/features/profile/account-menu";
import { useSession } from "@/hooks/use-auth";
import { fontFamilies } from "@/theme/typography";
import { CompanionStatus } from "./companion-status";
import { FeedbackMenu } from "./feedback-menu";
import { NavGroup } from "./nav-group";
import { NotificationSwitch } from "./notification-switch";
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
        bgcolor: "background.paper",
      }}
    >
      <Stack
        component={NextLink}
        href="/dashboard"
        aria-label="OpenApply dashboard"
        direction="row"
        sx={{
          alignItems: "center",
          px: 3,
          py: 2.75,
          textDecoration: "none",
          color: "text.primary",
        }}
      >
        <Typography
          sx={{
            fontFamily: fontFamilies.wordmark,
            fontWeight: 700,
            fontSize: "1.375rem",
            lineHeight: "28px",
            letterSpacing: "-0.01em",
          }}
        >
          OpenApply
        </Typography>
      </Stack>
      <Box sx={{ flex: 1, overflowY: "auto" }}>
        <Suspense>
          {visibleNavGroups(user?.role).map((group) => (
            <NavGroup key={group.items[0]?.href} group={group} />
          ))}
        </Suspense>
      </Box>
      <Suspense>
        {visibleNavGroups(user?.role, footerNavGroups).map((group) => (
          <NavGroup key={group.items[0]?.href} group={group} />
        ))}
      </Suspense>
      <NotificationSwitch />
      <CompanionStatus />
      <Stack direction="row" sx={{ alignItems: "center", px: 1.5, pb: 2, pt: 0.5 }}>
        <AccountMenu />
        <FeedbackMenu />
      </Stack>
    </Stack>
  );
}
