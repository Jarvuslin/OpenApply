"use client";

import type { ReactElement } from "react";
import { ExpandMore } from "@mui/icons-material";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Button,
  Divider,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { useApiQuery } from "@/api/hooks";
import { resumeQueries } from "@/api/queries";
import type { ResumeVariantDto } from "@/api/types";
import { useKeyedList } from "@/hooks/use-keyed-list";
import { matchesArtifactAudit } from "./artifact-audit-match";

type RewriteAudit = NonNullable<ResumeVariantDto["rewrites"]>;
type Grounding = NonNullable<RewriteAudit["experience"][number]["bullets"][number]["grounding"]>;

interface VariantWordingReviewProps {
  resumeId: string;
  variantId: string;
  updatedAt: Date | string;
}

interface TextListProps {
  title: string;
  values: readonly string[];
}

function TextList({ title, values }: TextListProps): ReactElement {
  const { keys } = useKeyedList(values.length);
  return (
    <Stack spacing={0.5}>
      <Typography variant="body2Strong">{title}</Typography>
      {values.length === 0 && <Typography variant="body2Muted">None recorded.</Typography>}
      {values.map((value, index) => (
        <Typography key={keys[index]} variant="body2" sx={{ overflowWrap: "anywhere" }}>
          {value}
        </Typography>
      ))}
    </Stack>
  );
}

interface GroundingReviewProps {
  grounding: Grounding;
  audit: RewriteAudit;
}

function GroundingReview({ grounding, audit }: GroundingReviewProps): ReactElement {
  const external = grounding.externalEvidence ?? [];
  return (
    <Accordion>
      <AccordionSummary expandIcon={<ExpandMore />}>
        <Typography variant="body2Strong">Evidence and job relevance</Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1.5}>
          <TextList
            title="Original resume evidence"
            values={grounding.evidence.map((source) => `${source.path}: ${source.quote}`)}
          />
          {external.length > 0 && (
            <TextList
              title="Additional evidence"
              values={external.map((source) => {
                const saved = audit.additionalEvidence?.find(
                  (item) => item.id === source.evidenceId && item.revision === source.revision,
                );
                const provenance = saved
                  ? `${saved.source.kind} · ${saved.verification.sourceRecord} · ${saved.status}: ${saved.verification.limitation}`
                  : "Snapshot unavailable";
                return `${source.evidenceId} · revision ${source.revision}: ${source.quote} · ${provenance}`;
              })}
            />
          )}
          <TextList
            title={grounding.target.kind === "job_description" ? "Job target" : "Review target"}
            values={[grounding.target.quote, grounding.target.reason]}
          />
          <Typography variant="body2Muted">
            {grounding.review.claimType === "explicit"
              ? "Explicit evidence"
              : "Supported inference"}
            {": "}
            {grounding.review.rationale}
          </Typography>
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}

interface AuditReviewProps {
  audit: RewriteAudit;
}

function AuditReview({ audit }: AuditReviewProps): ReactElement {
  const changes = [
    ...audit.experience.flatMap((entry) =>
      entry.bullets.map((bullet) => ({ label: entry.company, ...bullet })),
    ),
    ...(audit.projects ?? []).flatMap((entry) =>
      entry.bullets.map((bullet) => ({ label: entry.name, ...bullet })),
    ),
    ...(audit.summary ? [{ label: "Summary", ...audit.summary }] : []),
    ...(audit.headline ? [{ label: "Headline", ...audit.headline }] : []),
  ];
  const { keys } = useKeyedList(changes.length);
  const workflow = audit.workflowReview;
  const omissions = audit.omissions ?? [];
  return (
    <Stack spacing={2}>
      <Alert severity="info">
        Evidence support and workflow completion below are agent reports. These fields alone do not
        verify tool execution, factual correctness or employer ATS acceptance.
      </Alert>
      {changes.length === 0 && (
        <Typography variant="body2Muted">
          No wording changes were recorded for this variant.
        </Typography>
      )}
      <Stack spacing={2} divider={<Divider />}>
        {changes.map((change, index) => (
          <Stack key={keys[index]} spacing={1}>
            <Typography variant="body2Strong">{change.label}</Typography>
            <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
              <Paper variant="panel" sx={{ p: 1.5, flex: 1, minWidth: 0 }}>
                <Typography variant="captionMuted">Before</Typography>
                <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                  {change.original || "(empty)"}
                </Typography>
              </Paper>
              <Paper variant="panel" sx={{ p: 1.5, flex: 1, minWidth: 0 }}>
                <Typography variant="captionMuted">Saved wording</Typography>
                <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                  {change.tailored}
                </Typography>
              </Paper>
            </Stack>
            {change.grounding && <GroundingReview grounding={change.grounding} audit={audit} />}
            {!change.grounding && (
              <Typography variant="captionMuted">
                No evidence references were saved for this change.
              </Typography>
            )}
          </Stack>
        ))}
      </Stack>
      {omissions.length > 0 && (
        <TextList
          title="Disclosed omissions"
          values={omissions.map((item) => `${item.original} — ${item.reason}`)}
        />
      )}
      {!workflow && (
        <Alert severity="warning">No independent review or humanizer record was saved.</Alert>
      )}
      {workflow && (
        <Stack spacing={2}>
          <Typography variant="h6">Reported workflow</Typography>
          <TextList
            title="Evidence plan"
            values={workflow.evidencePlan.map(
              (item) => `${item.target}: ${item.change} · Sources: ${item.sources.join(", ")}`,
            )}
          />
          <Typography variant="body2Strong">
            Independent reviewer: {workflow.reviewer.status}
          </Typography>
          {workflow.reviewer.status === "unavailable" && (
            <Alert severity="warning">{workflow.reviewer.reason}</Alert>
          )}
          {workflow.reviewer.status === "completed" && (
            <Stack spacing={1}>
              <Typography variant="captionMuted" sx={{ overflowWrap: "anywhere" }}>
                Agent {workflow.reviewer.agentId} · Run {workflow.reviewer.runId ?? "not recorded"}{" "}
                · Invocation {workflow.reviewer.toolInvocationId ?? "not recorded"}
              </Typography>
              <TextList title="Findings" values={workflow.reviewer.findings} />
              <TextList title="Resolutions" values={workflow.reviewer.resolutions} />
            </Stack>
          )}
          <Typography variant="body2Strong">Humanizer: {workflow.humanizer.status}</Typography>
          {workflow.humanizer.status === "unavailable" && (
            <Alert severity="warning">{workflow.humanizer.reason}</Alert>
          )}
          {workflow.humanizer.status === "completed" && (
            <Typography variant="body2Muted" sx={{ overflowWrap: "anywhere" }}>
              Reported factual drift check completed · Run{" "}
              {workflow.humanizer.runId ?? "not recorded"} · Invocation{" "}
              {workflow.humanizer.toolInvocationId ?? "not recorded"}
            </Typography>
          )}
          <TextList
            title="Optional details for a later rewrite"
            values={workflow.optionalQuestions}
          />
        </Stack>
      )}
    </Stack>
  );
}

export function VariantWordingReview({
  resumeId,
  variantId,
  updatedAt,
}: VariantWordingReviewProps): ReactElement {
  const detail = useApiQuery(resumeQueries.variantDetail(variantId), { refetchOnMount: "always" });
  const current = useApiQuery(resumeQueries.artifact(resumeId, variantId, updatedAt));
  const artifact = current.data?.artifact;
  const matching =
    artifact && detail.data && matchesArtifactAudit(artifact.audit, detail.data.rewrites);
  const canReview = Boolean(current.data && detail.data && (!artifact || matching));
  const notes = artifact ? artifact.diffNotes : detail.data?.diffNotes;
  return (
    <Stack spacing={2} sx={{ mt: 3 }}>
      <Typography variant="h6">Wording and evidence</Typography>
      {(detail.isLoading || current.isLoading) && <LinearProgress />}
      {(detail.error || current.error) && (
        <Alert
          severity="error"
          action={
            <Button
              onClick={() => {
                void detail.refetch();
                void current.refetch();
              }}
            >
              Retry
            </Button>
          }
        >
          Could not load the saved wording review.
        </Alert>
      )}
      {artifact && (
        <Typography variant="captionMuted" sx={{ overflowWrap: "anywhere" }}>
          Saved PDF revision: {artifact.revision}
        </Typography>
      )}
      {current.data && !artifact && (
        <Alert severity="info">Draft wording — no generated artifact.</Alert>
      )}
      {artifact && detail.data && !matching && (
        <Alert severity="warning">
          The draft review differs from the displayed PDF revision. Use its Revision and evidence
          link for the immutable audit; draft wording is not shown as saved PDF evidence.
        </Alert>
      )}
      {canReview && notes && (
        <Typography variant="body2" sx={{ whiteSpace: "pre-line" }}>
          {notes}
        </Typography>
      )}
      {canReview && detail.data && !detail.data.rewrites && (
        <Typography variant="body2Muted">This variant has no saved wording audit.</Typography>
      )}
      {canReview && detail.data?.rewrites && (
        <AuditReview key={artifact?.revision ?? variantId} audit={detail.data.rewrites} />
      )}
    </Stack>
  );
}
