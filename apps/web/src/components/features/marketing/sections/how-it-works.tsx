import type { ReactElement } from "react";
import { Box, Card, Container, Stack, Typography } from "@mui/material";
import { LandingImage } from "../landing-image";
import { SectionHeading } from "../section-heading";

const STEPS = [
  {
    image: "/landing/step-rules.png",
    alt: "Pick-chips for roles, levels, company type, location and posted-within windows.",
    title: "Make a pilot",
    body: "Pick roles, levels, locations and how fresh the jobs must be. Turn on auto run if you want it to keep looking.",
  },
  {
    image: "/landing/step-score.png",
    alt: "Four jobs with match scores from 92% down to 61%; the weakest is greyed out.",
    title: "It finds and scores",
    body: "Every new posting is read in full and scored against your original resume. Weak matches are dropped.",
  },
  {
    image: "/landing/step-apply.png",
    alt: "Queue rows marked Applying now, Submitted, Needs you and Queued.",
    title: "It applies while you watch",
    body: "Good matches go to your queue. The agent fills each form in a real browser on your computer.",
  },
];

export function HowItWorks(): ReactElement {
  return (
    <Box id="how-it-works" sx={{ bgcolor: "surfaces.elevated", py: { xs: 7, md: 12 } }}>
      <Container maxWidth="lg">
        <SectionHeading
          eyebrow="How it works"
          title="Three steps, then it runs on its own"
          description="You set the rules once. OpenApply does the searching, scoring and form filling, and asks you only what it can't answer."
        />
        <Box
          sx={{
            mt: 6,
            display: "grid",
            gap: 3,
            gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "repeat(3, minmax(0, 1fr))" },
          }}
        >
          {STEPS.map((step, index) => (
            <Card key={step.title} sx={{ display: "flex", flexDirection: "column" }}>
              <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
                <LandingImage
                  src={step.image}
                  alt={step.alt}
                  width={764}
                  height={400}
                  radius={0}
                  sizes="(max-width: 900px) 100vw, 380px"
                />
              </Box>
              <Stack spacing={1} sx={{ p: 3 }}>
                <Box
                  sx={{
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    bgcolor: "statusTints.info",
                    color: "primary.main",
                  }}
                >
                  <Typography variant="body2Strong" sx={{ color: "inherit" }}>
                    {index + 1}
                  </Typography>
                </Box>
                <Typography variant="h4" component="h3">
                  {step.title}
                </Typography>
                <Typography variant="body2Muted">{step.body}</Typography>
              </Stack>
            </Card>
          ))}
        </Box>
      </Container>
    </Box>
  );
}
