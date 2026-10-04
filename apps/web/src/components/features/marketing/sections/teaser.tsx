"use client";

import { type ReactElement, useRef, useState } from "react";
import { PlayArrow } from "@mui/icons-material";
import { alpha, Box, Card, IconButton, Stack, Typography } from "@mui/material";
import { accent, line, surfaces } from "@/theme";
import { Section } from "../section";
import { SectionEyebrow } from "../section-eyebrow";
import { SectionGlow } from "../section-glow";

const POSTER = "/teaser-poster.jpg";
const SOURCE = "/teaser.mp4";

/** Poster + `preload="none"`: the 3 MB cut costs nothing until a visitor asks for it. */
export function Teaser(): ReactElement {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);

  const play = (): void => {
    setStarted(true);
    void videoRef.current?.play();
  };

  return (
    <Section id="see-it-run" tightTop>
      <Stack spacing={1.5} sx={{ mb: 3, maxWidth: 620 }}>
        <SectionEyebrow color="accent.primary">SEE IT RUN</SectionEyebrow>
        <Typography variant="h2">Forty seconds of the agent working.</Typography>
        <Typography variant="body1Muted" sx={{ fontSize: "0.9375rem" }}>
          Nothing here is a mockup: it's one real cycle, a real application form, and the pipeline
          filling up.
        </Typography>
      </Stack>

      <Box sx={{ position: "relative" }}>
        <SectionGlow color={alpha(accent.primary, 0.09)} spread={56} />
        <Card variant="showcase" sx={{ position: "relative" }}>
          <Box
            component="video"
            ref={videoRef}
            src={SOURCE}
            poster={POSTER}
            preload="none"
            playsInline
            controls={started}
            onEnded={() => setStarted(false)}
            sx={{ display: "block", width: "100%", height: "auto", aspectRatio: "16 / 9" }}
          />

          {!started && (
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                // The poster is a busy UI screenshot; the play button needs a strong scrim.
                background: `radial-gradient(ellipse 45% 55% at 50% 50%, ${alpha(surfaces.base, 0.72)}, ${alpha(surfaces.base, 0.5)} 70%)`,
              }}
            >
              <IconButton
                onClick={play}
                aria-label="Play the OpenApply teaser"
                sx={{
                  width: { xs: 64, md: 84 },
                  height: { xs: 64, md: 84 },
                  color: "common.white",
                  border: `1px solid ${alpha(accent.primary, 0.55)}`,
                  backgroundColor: alpha(accent.primary, 0.22),
                  backdropFilter: "blur(4px)",
                  transition: "transform 240ms, background-color 240ms",
                  "&:hover": {
                    backgroundColor: alpha(accent.primary, 0.36),
                    transform: "scale(1.06)",
                  },
                  "@media (prefers-reduced-motion: reduce)": {
                    transition: "none",
                    "&:hover": { transform: "none" },
                  },
                }}
              >
                <PlayArrow sx={{ fontSize: { xs: 32, md: 42 } }} />
              </IconButton>

              {/* Corner pill, not under the button, where it would collide with the poster's UI. */}
              <Typography
                variant="monoChip"
                sx={{
                  position: "absolute",
                  left: { xs: 12, md: 16 },
                  bottom: { xs: 12, md: 16 },
                  fontSize: "0.6875rem",
                  color: "common.white",
                  borderColor: line.divider,
                  backgroundColor: alpha(surfaces.base, 0.7),
                }}
              >
                40s · no sound
              </Typography>
            </Box>
          )}
        </Card>
      </Box>
    </Section>
  );
}
