import type { ReactElement } from "react";
import { Box, Container, Stack, Typography } from "@mui/material";
import { LinkButton } from "@/components/ui/buttons";
import { LandingImage } from "../landing-image";

export function Hero(): ReactElement {
  return (
    <Container maxWidth="lg" sx={{ pt: { xs: 7, md: 11 }, pb: { xs: 5, md: 8 } }}>
      <Stack spacing={2.5} sx={{ alignItems: "center", textAlign: "center" }}>
        <Stack
          direction="row"
          spacing={1}
          sx={{
            alignItems: "center",
            px: 1.75,
            py: 0.75,
            border: 1,
            borderColor: "divider",
            borderRadius: 999,
          }}
        >
          <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: "statusDots.done" }} />
          <Typography variant="body2Strong" sx={{ color: "text.prose" }}>
            Free · open source · runs on your computer
          </Typography>
        </Stack>
        <Typography variant="displayLg" component="h1" sx={{ maxWidth: 860 }}>
          Set the rules.
          <br />
          Wake up to applications.
        </Typography>
        <Typography
          variant="body1Muted"
          sx={{ fontSize: "1.125rem", lineHeight: 1.6, maxWidth: 640 }}
        >
          OpenApply finds new jobs minutes after they are posted, scores each one against your
          resume, and applies with the Claude or Codex plan you already pay for. You only step in
          when it needs you.
        </Typography>
        <Stack
          direction="row"
          spacing={1.25}
          sx={{ pt: 1, flexWrap: "wrap", justifyContent: "center", gap: 1.25 }}
        >
          <LinkButton href="/install" variant="contained" size="large">
            Get started — free
          </LinkButton>
          <LinkButton href="/#how-it-works" variant="outlined" size="large">
            See how it works
          </LinkButton>
        </Stack>
        <Typography variant="captionMuted">
          No API keys · Works with Claude Code or Codex · Windows and macOS
        </Typography>
      </Stack>
      <Box sx={{ mt: { xs: 5, md: 7 } }}>
        <LandingImage
          src="/landing/hero.png"
          alt="A pilot's review page: jobs grouped by when they were posted, each with a match score, and a question from a Shopify application waiting for an answer."
          width={2400}
          height={1120}
          priority
          sizes="(max-width: 1200px) 100vw, 1200px"
        />
      </Box>
    </Container>
  );
}
