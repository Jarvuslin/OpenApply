"use client";

import { type ReactElement, useState } from "react";
import { Menu as MenuIcon } from "@mui/icons-material";
import { Box, Container, Drawer, IconButton, Link, Stack } from "@mui/material";
import type { Route } from "next";
import { BrandMark } from "./brand-mark";
import { marketingLinkSx } from "./marketing-link-sx";
import { MarketingSessionLink } from "./marketing-session-link";

interface NavLink {
  href: Route;
  label: string;
}

/** `/#how-it-works`, not `#how-it-works`: from /jobs or /docs the bare hash points at nothing. */
const NAV_LINKS: NavLink[] = [
  { href: "/docs" as Route, label: "Docs" },
  { href: "/#how-it-works" as Route, label: "How it works" },
];

function NavLinks(): ReactElement {
  return (
    <>
      {NAV_LINKS.map((link) => (
        <Link key={link.href} href={link.href} underline="none" sx={marketingLinkSx}>
          {link.label}
        </Link>
      ))}
    </>
  );
}

export function MarketingNav(): ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <Box
      component="header"
      sx={(theme) => ({
        position: "sticky",
        top: 0,
        zIndex: theme.zIndex.appBar,
        borderBottom: `1px solid ${theme.palette.line.divider}`,
        backgroundColor: `color-mix(in srgb, ${theme.palette.surfaces.base} 86%, transparent)`,
        backdropFilter: "blur(8px)",
      })}
    >
      <Container maxWidth="lg">
        <Stack
          direction="row"
          sx={{ alignItems: "center", justifyContent: "space-between", height: 64 }}
        >
          <Stack direction="row" spacing={4} sx={{ alignItems: "center" }}>
            <BrandMark />
            <Stack
              direction="row"
              spacing={3}
              sx={{ alignItems: "center", display: { xs: "none", sm: "flex" } }}
            >
              <NavLinks />
            </Stack>
          </Stack>

          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <MarketingSessionLink />
            <IconButton
              aria-label="Open menu"
              onClick={() => setOpen(true)}
              sx={{ display: { xs: "inline-flex", sm: "none" } }}
            >
              <MenuIcon />
            </IconButton>
          </Stack>
        </Stack>
      </Container>

      <Drawer anchor="right" open={open} onClose={() => setOpen(false)}>
        <Stack component="nav" spacing={2} sx={{ width: 240, p: 3 }} onClick={() => setOpen(false)}>
          <NavLinks />
        </Stack>
      </Drawer>
    </Box>
  );
}
