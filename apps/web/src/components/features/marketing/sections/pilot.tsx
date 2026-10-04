import type { ReactElement } from "react";
import { alpha, Box, Container, Grid, Link, Stack, Typography } from "@mui/material";
import { LinkButton } from "@/components/ui/buttons";
import { accent, fontFamilies } from "@/theme";
import { SectionEyebrow } from "../section-eyebrow";
import { PilotCycle } from "./pilot-cycle";

// A server component, so sx must stay a plain object - a `(theme) => …` callback
// is a function, and functions cannot cross the RSC boundary.
const emberWash = `radial-gradient(ellipse 70% 70% at 50% 0%, ${alpha(accent.primary, 0.08)}, transparent 60%)`;

interface Step {
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    title: "Set your instructions",
    body: "What roles you want, how many applications a day, which searches to keep warm, how bold the recruiter outreach should be. You write it in plain sentences rather than a config file.",
  },
  {
    title: "Let it work",
    body: "The agent keeps working while you sleep: it finds and scores new roles, applies to the good matches, looks for someone to introduce you before applying cold, and nudges recruiters who went quiet.",
  },
  {
    title: "Answer from your phone",
    body: "When it hits something only you can answer (a salary question, a login code, a message it wants to send) you get a one-tap card by push. Answer it and the parked job picks back up.",
  },
  {
    title: "Wake to a journal",
    body: "Every action lands in a live feed, rolled into a morning digest: applications sent, replies reviewed, questions waiting. The dashboard itself enforces your daily limits, so they hold even if a cycle goes off-script.",
  },
];

export function Pilot(): ReactElement {
  return (
    <Box
      sx={{
        position: "relative",
        overflow: "hidden",
        borderBlock: 1,
        borderColor: "line.divider",
        backgroundColor: "surfaces.card",
      }}
    >
      <Box
        aria-hidden
        sx={{ position: "absolute", inset: 0, background: emberWash, pointerEvents: "none" }}
      />
      <Container maxWidth="lg" sx={{ position: "relative", paddingBlock: { xs: 7, md: 10 } }}>
        <Grid container spacing={{ xs: 4, md: 6 }} sx={{ mb: 6, alignItems: "center" }}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Stack spacing={2}>
              <SectionEyebrow color="accent.primary">THE PILOT · AUTONOMOUS MODE</SectionEyebrow>
              <Typography variant="h2">Write your goals once. Close the lid.</Typography>
              <Typography variant="body1Muted" sx={{ fontSize: "0.9375rem" }}>
                The Pilot is OpenApply running unattended. You give it instructions and limits; it
                works through your search on its own, asks when it's unsure, and keeps a journal you
                can read over coffee, so you never have to drive every step by hand.
              </Typography>
            </Stack>
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <PilotCycle />
          </Grid>
        </Grid>
        <Grid container spacing={4}>
          {STEPS.map((step, i) => (
            <Grid key={step.title} size={{ xs: 12, sm: 6, md: 3 }}>
              <Stack spacing={1.5} sx={{ alignItems: "flex-start" }}>
                <Typography
                  sx={{
                    fontFamily: fontFamilies.mono,
                    fontSize: "1.5rem",
                    fontWeight: 700,
                    color: "accent.primary",
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </Typography>
                <Typography variant="h3" sx={{ fontSize: "1.2rem" }}>
                  {step.title}
                </Typography>
                <Typography variant="body2Muted">{step.body}</Typography>
              </Stack>
            </Grid>
          ))}
        </Grid>
        <Stack
          direction="row"
          spacing={2}
          sx={{ mt: 5, flexWrap: "wrap", gap: 2, alignItems: "center" }}
        >
          <LinkButton href="/install" variant="contained" size="large">
            Put it on autopilot
          </LinkButton>
          <Typography variant="body2Muted">
            <Link href="/docs/pilot">Read the Pilot guide</Link>
          </Typography>
        </Stack>
      </Container>
    </Box>
  );
}
