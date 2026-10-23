import type { ReactElement } from "react";
import { Box, Card, Container, Stack, Typography } from "@mui/material";
import { fontFamilies } from "@/theme";
import { SectionHeading } from "../section-heading";

const STEPS = [
  {
    title: "Install the plugin",
    body: "Add OpenApply to Claude Code or Codex. The setup skill installs and starts the computer app.",
    hint: "/plugin install openapply",
  },
  {
    title: "Create your account",
    body: "Sign up, upload your resume, and save your one job login.",
    hint: "Sign up · upload resume",
  },
  {
    title: "Make your first pilot",
    body: "Pick your roles and how fresh the jobs must be, then press Run now.",
    hint: "Pilots → New pilot",
  },
];

export function Setup(): ReactElement {
  return (
    <Box sx={{ bgcolor: "surfaces.elevated", py: { xs: 7, md: 12 } }}>
      <Container maxWidth="lg">
        <SectionHeading eyebrow="Get started" title="From install to your first application" />
        <Box
          component="ol"
          sx={{
            mt: 6,
            p: 0,
            listStyle: "none",
            display: "grid",
            gap: 2.5,
            gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "repeat(3, minmax(0, 1fr))" },
          }}
        >
          {STEPS.map((step, index) => (
            <Card key={step.title} component="li" sx={{ p: 3 }}>
              <Stack spacing={1.25} sx={{ alignItems: "flex-start" }}>
                <Typography variant="body2Strong" sx={{ color: "primary.main" }}>
                  0{index + 1}
                </Typography>
                <Typography variant="h4" component="h3">
                  {step.title}
                </Typography>
                <Typography variant="body2Muted">{step.body}</Typography>
                <Typography
                  variant="caption"
                  sx={{
                    fontFamily: fontFamilies.mono,
                    px: 1.25,
                    py: 0.5,
                    borderRadius: 1,
                    bgcolor: "surfaces.hover",
                    color: "text.prose",
                  }}
                >
                  {step.hint}
                </Typography>
              </Stack>
            </Card>
          ))}
        </Box>
      </Container>
    </Box>
  );
}
