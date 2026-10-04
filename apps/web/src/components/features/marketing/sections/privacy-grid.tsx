import type { ReactElement, ReactNode } from "react";
import { Card, CardContent, Grid, Link, Stack, Typography } from "@mui/material";
import { GITHUB_URL } from "@/lib/constants";
import { Section } from "../section";
import { SectionEyebrow } from "../section-eyebrow";

const FACTS = [
  {
    title: "Your subscription",
    body: "The agent runs on your Claude or Codex plan. OpenApply ships no model keys and adds no per-job fees.",
  },
  {
    title: "Your machine",
    body: "The terminal and browser run locally. Watch every action in the agent dock; stop it whenever you like.",
  },
  {
    title: "Encrypted credentials",
    body: "Board logins and captcha keys are encrypted with a key only your account holds. Deleting your account destroys it.",
  },
  {
    title: "Your own Gmail client",
    body: "Email runs through your personal Google OAuth client. No shared app sits between OpenApply and your mail.",
  },
];

interface FactCardProps {
  title: string;
  children: ReactNode;
}

function FactCard(props: FactCardProps): ReactElement {
  const { title, children } = props;
  return (
    <Card sx={{ height: "100%" }}>
      <CardContent>
        <Stack spacing={1}>
          <Typography variant="h4" component="h3">
            {title}
          </Typography>
          <Typography variant="body2Muted">{children}</Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

export function PrivacyGrid(): ReactElement {
  return (
    <Section>
      <Stack spacing={1} sx={{ mb: 4 }}>
        <SectionEyebrow>TRUST</SectionEyebrow>
        <Typography variant="h2">Free, open source, and yours to run.</Typography>
      </Stack>
      <Grid container spacing={2}>
        {FACTS.map((fact) => (
          <Grid key={fact.title} size={{ xs: 12, sm: 6 }}>
            <FactCard title={fact.title}>{fact.body}</FactCard>
          </Grid>
        ))}
        <Grid size={12}>
          <FactCard title="Open source">
            The dashboard, API, terminal host, and plugin are all{" "}
            {/* component="a": next/link is the theme's MuiLink default, wrong for an off-site URL. */}
            <Link component="a" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              public on GitHub
            </Link>
            .
          </FactCard>
        </Grid>
      </Grid>
    </Section>
  );
}
