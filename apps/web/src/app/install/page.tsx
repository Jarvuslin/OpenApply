import type { ReactElement } from "react";
import { Box, Stack, Typography } from "@mui/material";
import type { Metadata } from "next";
import { InstallGuide } from "@/components/features/install";
import {
  MarketingFooter,
  MarketingNav,
  Section,
  SectionEyebrow,
} from "@/components/features/marketing";

export const metadata: Metadata = {
  title: "Install OpenApply",
  description: "Clone OpenApply and configure your local workspace, agent and browser VM.",
  alternates: { canonical: "/install" },
};

export default function InstallPage(): ReactElement {
  return (
    <Box sx={{ minHeight: "100vh", backgroundColor: "surfaces.base", overflowX: "clip" }}>
      <MarketingNav />
      <Box component="main">
        <Section maxWidth="md">
          <Stack spacing={3}>
            <Stack spacing={2}>
              <SectionEyebrow color="accent.primary">SETUP</SectionEyebrow>
              <Typography variant="h1" sx={{ fontSize: { xs: "2rem", md: "2.75rem" } }}>
                Set up your OpenApply workspace.
              </Typography>
              <Typography variant="body1Muted" sx={{ maxWidth: 560 }}>
                Run the local MVP from source with your own Claude Code or Codex account. The README
                covers dependencies, the browser VM, Gmail and first-run setup.
              </Typography>
            </Stack>
            <InstallGuide />
          </Stack>
        </Section>
      </Box>
      <MarketingFooter />
    </Box>
  );
}
