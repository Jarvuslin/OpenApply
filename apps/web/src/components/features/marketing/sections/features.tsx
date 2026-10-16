import type { ReactElement } from "react";
import { Box, Container, Stack, Typography } from "@mui/material";
import { Check } from "lucide-react";
import { LandingImage } from "../landing-image";
import { SectionHeading } from "../section-heading";

interface Feature {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  image: string;
  alt: string;
}

const FEATURES: Feature[] = [
  {
    id: "pilots",
    eyebrow: "Pilots",
    title: "Catch new jobs in their first 30 minutes",
    body: "Early applicants get read. A pilot checks the job feeds on a timer and picks up postings that match your rules, often within minutes of going live.",
    points: [
      "Look back 30 minutes, an hour, a day or more, and see results grouped by when they were posted",
      "Run every 10 minutes, every hour, daily, or only when you press Run now",
      "Hold matches for your review, or add them straight to your queue",
    ],
    image: "/landing/feature-pilots.png",
    alt: "A pilot's schedule: auto run every 10 minutes, hold matches for review, up to 15 jobs per run.",
  },
  {
    id: "live-view",
    eyebrow: "Your queue",
    title: "Watch every application as it happens",
    body: "Each job runs in a real browser on your computer, not a server somewhere. Open any job to see the page the agent is on and the step it is at.",
    points: [
      "Live view of the career site while the form is filled",
      "Pause, stop or retry any job, or remove it from the queue",
      "Nothing is submitted twice, even after a crash or restart",
    ],
    image: "/landing/feature-live.png",
    alt: "The live view of a Lever application form, with the steps the agent has finished.",
  },
  {
    id: "needs-you",
    eyebrow: "Needs you",
    title: "Only the questions it can't answer",
    body: "Most questions are answered from your profile and the answers you gave before. When a form asks something new, the job waits for you and the rest of the queue keeps going.",
    points: [
      "Answer in one tap, from the web or Telegram",
      "Your answer is remembered for every future application",
      "Salary, work permits and start dates come from your profile",
    ],
    image: "/landing/feature-needs-you.png",
    alt: "A salary question from a Shopify application with the profile answer preselected.",
  },
];

export function Features(): ReactElement {
  return (
    <>
      {FEATURES.map((feature, index) => {
        const flipped = index % 2 === 1;
        return (
          <Box
            key={feature.id}
            id={feature.id}
            sx={{ bgcolor: flipped ? "surfaces.elevated" : "surfaces.base", py: { xs: 7, md: 12 } }}
          >
            <Container maxWidth="lg">
              <Box
                sx={{
                  display: "grid",
                  gap: { xs: 5, md: 9 },
                  alignItems: "center",
                  gridTemplateColumns: {
                    xs: "minmax(0, 1fr)",
                    md: "minmax(0, 5fr) minmax(0, 7fr)",
                  },
                }}
              >
                <Stack spacing={2.5} sx={{ order: { md: flipped ? 2 : 1 } }}>
                  <SectionHeading
                    align="left"
                    eyebrow={feature.eyebrow}
                    title={feature.title}
                    description={feature.body}
                  />
                  <Stack component="ul" spacing={1.25} sx={{ m: 0, p: 0, listStyle: "none" }}>
                    {feature.points.map((point) => (
                      <Stack key={point} component="li" direction="row" spacing={1.25}>
                        <Box sx={{ color: "primary.main", pt: 0.25, display: "flex" }}>
                          <Check size={16} strokeWidth={2.25} aria-hidden />
                        </Box>
                        <Typography variant="body1" sx={{ color: "text.prose" }}>
                          {point}
                        </Typography>
                      </Stack>
                    ))}
                  </Stack>
                </Stack>
                <Box sx={{ order: { md: flipped ? 1 : 2 } }}>
                  <LandingImage
                    src={feature.image}
                    alt={feature.alt}
                    width={1376}
                    height={920}
                    sizes="(max-width: 900px) 100vw, 688px"
                  />
                </Box>
              </Box>
            </Container>
          </Box>
        );
      })}
    </>
  );
}
