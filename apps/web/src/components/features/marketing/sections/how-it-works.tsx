import type { ReactElement } from "react";
import { Box, Grid, Stack, Typography } from "@mui/material";
import { fontFamilies, line, radii } from "@/theme";
import { Section } from "../section";

const STEPS = [
  {
    title: "Install the plugin",
    body: "Add OpenApply to the Claude Code or Codex subscription you already have; it needs no API keys of its own. The setup skill installs and starts the local agent.",
    snippet: "/plugin install openapply  ·  /openapply:setup",
  },
  {
    title: "Create your account",
    body: "Sign up and upload your resume. The agent parses it into the profile it scores and applies with.",
    snippet: "localhost:4100/register",
  },
  {
    title: "Run a campaign",
    body: "Everything after setup is a button in the dashboard. Start with a search, graduate to auto-apply.",
    snippet: "New campaign  ·  Search → Auto-apply",
  },
];

export function HowItWorks(): ReactElement {
  return (
    <Box
      id="how-it-works"
      sx={{ borderBlock: 1, borderColor: "line.divider", backgroundColor: "surfaces.card" }}
    >
      <Section>
        <Typography variant="h2" sx={{ mb: 4 }}>
          From install to your first application.
        </Typography>
        <Grid container spacing={4}>
          {STEPS.map((step, i) => (
            <Grid key={step.title} size={{ xs: 12, md: 4 }}>
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
                <Box
                  component="code"
                  sx={{
                    fontFamily: fontFamilies.mono,
                    fontSize: "0.75rem",
                    color: "text.secondary",
                    backgroundColor: "surfaces.elevated",
                    border: `1px solid ${line.divider}`,
                    borderRadius: radii.sm,
                    paddingInline: 1,
                    paddingBlock: 0.5,
                  }}
                >
                  {step.snippet}
                </Box>
              </Stack>
            </Grid>
          ))}
        </Grid>
      </Section>
    </Box>
  );
}
