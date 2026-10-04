import type { ReactElement, ReactNode } from "react";
import { Box, Card, CardContent, Chip, Divider, Grid, Stack, Typography } from "@mui/material";
import type { JobListingDto } from "@/api/types";
import { BackLink, LinkButton } from "@/components/ui/buttons";
import { ExternalLink, LabelValue, RelativeTime } from "@/components/ui/display";
import { formatDate, formatRelativeTime } from "@/utils/format";
import { SkillChips } from "./skill-chips";

interface JobDetailProps {
  job: JobListingDto;
}

export function JobDetail(props: JobDetailProps): ReactElement {
  const { job } = props;

  return (
    <Stack spacing={3}>
      <BackLink href="/jobs">All jobs</BackLink>

      <Stack spacing={1.5}>
        <Typography variant="displayMd" sx={{ overflowWrap: "anywhere" }}>
          {job.title}
        </Typography>
        <Typography variant="h4" component="h2" sx={{ color: "text.secondary" }}>
          {job.company}
        </Typography>
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}>
          {job.remote && <Chip label="Remote" size="small" color="success" variant="outlined" />}
          {job.yearsExperience !== null && (
            <Chip label={`${job.yearsExperience}+ years`} size="small" variant="outlined" />
          )}
          {job.location && <Typography variant="body2Muted">{job.location}</Typography>}
          {job.employmentType && <Typography variant="body2Muted">{job.employmentType}</Typography>}
          {job.salary && (
            <Typography variant="body2Strong" sx={{ color: "accent.primary" }}>
              {job.salary}
            </Typography>
          )}
        </Stack>
      </Stack>

      <Grid container spacing={{ xs: 3, md: 4 }} sx={{ alignItems: "flex-start" }}>
        {/* CTA is first in source so it leads on a phone; `order` moves it right on md+. */}
        <Grid size={{ xs: 12, md: 4 }} sx={{ order: { xs: 1, md: 2 } }}>
          <Stack spacing={3}>
            <ApplyCard slug={job.slug} />
            <SkillsCard job={job} />
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, md: 8 }} sx={{ order: { xs: 2, md: 1 } }}>
          <Stack spacing={4}>
            {job.descriptionExcerpt && (
              <Section title="About the role">
                {/* pre-line alone still only wraps at whitespace: one long scraped token would overflow. */}
                <Typography
                  variant="body1Muted"
                  sx={{ whiteSpace: "pre-line", overflowWrap: "anywhere" }}
                >
                  {job.descriptionExcerpt}
                </Typography>
              </Section>
            )}

            {job.requirements.length > 0 && (
              <Section title="Requirements">
                <BulletList items={job.requirements} />
              </Section>
            )}

            {job.responsibilities.length > 0 && (
              <Section title="What you'll do">
                <BulletList items={job.responsibilities} />
              </Section>
            )}

            <Divider />

            <Section title="Where this was posted">
              <Stack component="ul" spacing={1} sx={{ listStyle: "none", m: 0, p: 0 }}>
                {job.sources.map((source) => (
                  <Stack
                    component="li"
                    key={source.url}
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: "center", flexWrap: "wrap" }}
                  >
                    {source.board && <Chip label={source.board} size="small" variant="outlined" />}
                    <ExternalLink href={source.url} truncateTo={320}>
                      {source.url}
                    </ExternalLink>
                    <RelativeTime value={source.lastSeenAt} />
                  </Stack>
                ))}
              </Stack>
              {job.sourceCount > 1 && (
                <Typography variant="captionMuted">
                  The same posting was found on {job.sourceCount} boards and deduped into this page.
                </Typography>
              )}
              <Typography variant="captionMuted">
                Seen {formatRelativeTime(job.lastSeenAt)} ago · first found{" "}
                {formatDate(job.firstSeenAt)}
              </Typography>
            </Section>
          </Stack>
        </Grid>
      </Grid>
    </Stack>
  );
}

function Section(props: { title: string; children: ReactNode }): ReactElement {
  return (
    <Stack spacing={1.5}>
      <Typography variant="h4" component="h3">
        {props.title}
      </Typography>
      {props.children}
    </Stack>
  );
}

function BulletList(props: { items: string[] }): ReactElement {
  return (
    <Box component="ul" sx={{ m: 0, pl: 3, display: "grid", gap: 1 }}>
      {props.items.map((item) => (
        <Typography component="li" key={item} variant="body1Muted">
          {item}
        </Typography>
      ))}
    </Box>
  );
}

function ApplyCard({ slug }: { slug: string }): ReactElement {
  return (
    <Card variant="accent">
      <CardContent>
        <Stack spacing={1.5}>
          <Typography variant="h4" component="h3">
            Apply with OpenApply
          </Typography>
          <Typography variant="body2Muted">
            Your own AI agent tailors your resume and fills the form - on your machine, on your
            Claude or Codex plan.
          </Typography>
          <LinkButton href={`/mvp?job=${encodeURIComponent(slug)}`} variant="contained" fullWidth>
            Review and apply
          </LinkButton>
        </Stack>
      </CardContent>
    </Card>
  );
}

/** Location, salary, employment type and years already sit in the header, so only skills are here. */
function SkillsCard(props: JobDetailProps): ReactNode {
  const { job } = props;

  if (job.skills.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardContent>
        <LabelValue label="Skills">
          <Box sx={{ mt: 0.75 }}>
            <SkillChips skills={job.skills} linked />
          </Box>
        </LabelValue>
      </CardContent>
    </Card>
  );
}
