import type { ReactElement } from "react";
import { ExpandMore } from "@mui/icons-material";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Card,
  CardContent,
  Divider,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import type { EvaluationCase } from "@openapply/contracts/scoring-evaluation";
import type { Route } from "next";
import NextLink from "next/link";
import { ScoringResult } from "./scoring-result";

interface ScoringCaseCardProps {
  item: EvaluationCase;
}

const ELIGIBILITY = {
  no_known_restriction: "No known restriction",
  eligible: "Recorded restrictions met",
  ineligible: "Recorded restriction not met",
  needs_review: "Needs factual review",
};

export function ScoringCaseCard(props: ScoringCaseCardProps): ReactElement {
  const { item } = props;
  return (
    <Card variant="outlined" data-scoring-case-id={item.id}>
      <CardContent>
        <Stack spacing={1.5}>
          <Typography variant="h6">{item.context.job.title}</Typography>
          <Typography variant="body2">
            {item.context.job.company} · Cutoff: {item.context.minMatchScore}/100 · Original resume
            rubric: {item.context.basis.version}
          </Typography>
          <Link component={NextLink} href={`/campaigns/${item.campaignId}` as Route}>
            View source job
          </Link>
          <Typography variant="caption" sx={{ overflowWrap: "anywhere" }}>
            Context SHA-256: {item.contextHash}
          </Typography>
          <Typography variant="body2">
            Eligibility: {ELIGIBILITY[item.eligibility.outcome]}
          </Typography>
          {item.eligibility.outcome === "needs_review" && (
            <Alert severity="warning">
              Unknown factual requirements remain unresolved. A fit score does not answer them.
            </Alert>
          )}
          {item.historicalReference && (
            <Typography variant="body2">
              Historical reference: {item.historicalReference.score}/100. This is a prior judgment,
              not ground truth or a measured comparison.
            </Typography>
          )}
          <ScoringResult
            slot="baseline"
            result={item.results.find((result) => result.slot === "baseline")}
          />
          <Divider />
          <ScoringResult
            slot="candidate"
            result={item.results.find((result) => result.slot === "candidate")}
          />
          <Accordion slotProps={{ transition: { unmountOnExit: true } }}>
            <AccordionSummary expandIcon={<ExpandMore />}>
              <Typography>Immutable inputs and eligibility evidence</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={1}>
                <Typography variant="caption" sx={{ overflowWrap: "anywhere" }}>
                  Original source SHA-256: {item.context.basis.sourceSha256}
                </Typography>
                <Typography variant="caption" sx={{ overflowWrap: "anywhere" }}>
                  Original text SHA-256: {item.context.basis.sourceTextSha256}
                </Typography>
                <Typography variant="caption" sx={{ overflowWrap: "anywhere" }}>
                  Job SHA-256: {item.context.basis.jobSha256}
                </Typography>
                <Typography variant="caption" sx={{ overflowWrap: "anywhere" }}>
                  Preferences SHA-256: {item.context.basis.preferencesSha256}
                </Typography>
                <Typography variant="body2">
                  Country context: {item.eligibility.facts?.countryCode ?? "Unconfirmed"} · Facts
                  confirmed:{" "}
                  {item.factsConfirmedAt
                    ? new Date(item.factsConfirmedAt).toLocaleString()
                    : "Not confirmed"}
                </Typography>
                {item.eligibility.restrictions.map((restriction) => (
                  <Typography
                    key={`${restriction.source}:${restriction.start}:${restriction.end}:${restriction.kind}`}
                    variant="body2"
                  >
                    {restriction.kind}: {restriction.outcome.replaceAll("_", " ")} ·{" "}
                    {restriction.source} [{restriction.start}–{restriction.end}] “
                    {restriction.quote}”
                  </Typography>
                ))}
                <Typography variant="subtitle2">Original resume text</Typography>
                <Typography
                  variant="body2"
                  sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                >
                  {item.context.resume.text}
                </Typography>
                <Typography variant="subtitle2">Job description snapshot</Typography>
                <Typography
                  variant="body2"
                  sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                >
                  {item.context.job.description}
                </Typography>
              </Stack>
            </AccordionDetails>
          </Accordion>
        </Stack>
      </CardContent>
    </Card>
  );
}
