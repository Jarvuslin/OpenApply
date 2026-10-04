import type { ReactElement } from "react";
import { alpha, Box, Container, Grid, Stack, Typography } from "@mui/material";
import { LinkButton } from "@/components/ui/buttons";
import { accent, fontFamilies, gradients } from "@/theme";
import { SectionEyebrow } from "../section-eyebrow";
import { AgentTranscript } from "./agent-transcript";

// A server component, so sx must stay a plain object - a `(theme) => …` callback
// is a function, and functions cannot cross the RSC boundary.
const emberWash = `radial-gradient(ellipse 80% 60% at 50% -10%, ${alpha(accent.primary, 0.09)}, transparent 60%)`;

export function Hero(): ReactElement {
  return (
    <Box sx={{ position: "relative", overflow: "hidden" }}>
      {/* Ember wash anchored above the fold - lifts the hero off the carbon base. */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          background: emberWash,
          pointerEvents: "none",
        }}
      />
      {/* Ambient brand orb. */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          top: -180,
          right: -120,
          width: 520,
          height: 520,
          background: gradients.orb,
          filter: "blur(120px)",
          opacity: 0.16,
          pointerEvents: "none",
        }}
      />
      {/* Light bottom padding: the hero runs into the teaser rather than sitting a section apart. */}
      <Container
        maxWidth="lg"
        sx={{
          position: "relative",
          paddingTop: { xs: 6, md: 10 },
          paddingBottom: { xs: 2, md: 3 },
        }}
      >
        <Grid container spacing={6} sx={{ alignItems: "center" }}>
          <Grid size={{ xs: 12, md: 7 }}>
            <Stack spacing={3}>
              <SectionEyebrow color="accent.primary">AUTONOMOUS · LOCAL-FIRST</SectionEyebrow>
              <Typography variant="displayLg" sx={{ textWrap: "balance" }}>
                Job search on autopilot, on your machine.
              </Typography>
              <Typography variant="body1Muted" sx={{ fontSize: "1.05rem", maxWidth: 560 }}>
                Tell OpenApply what you're looking for. It finds roles, tailors your resume,
                applies, and messages recruiters, all on the Claude or Codex subscription you
                already pay for. Every morning it leaves you a journal of what it did.
              </Typography>
              <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", gap: 1.5 }}>
                <LinkButton href="/install" variant="contained" size="large">
                  Install the agent
                </LinkButton>
                <LinkButton href="/login" variant="outlined" size="large">
                  Sign in
                </LinkButton>
              </Stack>
              <Typography
                sx={{ fontFamily: fontFamilies.mono, fontSize: "0.75rem", color: "text.disabled" }}
              >
                No API keys · Runs on your Claude / Codex subscription
              </Typography>
            </Stack>
          </Grid>
          <Grid size={{ xs: 12, md: 5 }}>
            <AgentTranscript />
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
}
