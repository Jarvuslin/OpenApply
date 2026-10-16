import type { ReactElement } from "react";
import { Box, Container, Stack, Typography } from "@mui/material";
import { Globe, Laptop, Lock, Zap } from "lucide-react";
import { SectionHeading } from "../section-heading";

const ICON = { size: 20, strokeWidth: 1.75, "aria-hidden": true } as const;

const POINTS = [
  {
    icon: <Zap {...ICON} />,
    title: "Your subscription",
    body: "Runs on your Claude or Codex plan. No API keys, no per-job fees.",
  },
  {
    icon: <Laptop {...ICON} />,
    title: "Your machine",
    body: "The browser and agent run locally. Stop it whenever you like.",
  },
  {
    icon: <Lock {...ICON} />,
    title: "Encrypted login",
    body: "Your job login and captcha key are encrypted with a key only your account holds.",
  },
  {
    icon: <Globe {...ICON} />,
    title: "Open source",
    body: "The web app, API, computer app and plugin are all public on GitHub.",
  },
];

export function PrivacyGrid(): ReactElement {
  return (
    <Box sx={{ py: { xs: 7, md: 12 } }}>
      <Container maxWidth="lg">
        <SectionHeading eyebrow="Yours to run" title="Free, open source, and on your computer" />
        <Box
          sx={{
            mt: 6,
            display: "grid",
            gap: 4,
            gridTemplateColumns: {
              xs: "minmax(0, 1fr)",
              sm: "repeat(2, minmax(0, 1fr))",
              md: "repeat(4, minmax(0, 1fr))",
            },
          }}
        >
          {POINTS.map((point) => (
            <Stack key={point.title} spacing={1}>
              <Box sx={{ color: "primary.main", display: "flex" }}>{point.icon}</Box>
              <Typography variant="h4" component="h3">
                {point.title}
              </Typography>
              <Typography variant="body2Muted">{point.body}</Typography>
            </Stack>
          ))}
        </Box>
      </Container>
    </Box>
  );
}
