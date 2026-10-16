"use client";

import type { ReactElement } from "react";
import { Alert, Button, Chip, LinearProgress, Link, Paper, Stack, Typography } from "@mui/material";
import {
  RESUME_EVIDENCE_STATUSES,
  type ResumeEvidence,
} from "@openapply/contracts/resume-evidence";
import { useSearchParams } from "next/navigation";
import { api } from "@/api/client";
import { useApiMutation, useApiQuery } from "@/api/hooks";
import { resumeQueries } from "@/api/queries";
import { queryKeys } from "@/api/query-keys";
import { PaginationFooter } from "@/components/ui/data";
import { SelectField } from "@/components/ui/form";
import { SectionCard } from "@/components/ui/layout";
import { usePaginationParams } from "@/hooks/use-pagination";

interface EvidencePanelProps {
  resumeId: string;
}

interface EvidenceRecordProps {
  evidence: ResumeEvidence;
  onRetract: () => void;
  busy: boolean;
}

function EvidenceRecord({ evidence, onRetract, busy }: EvidenceRecordProps): ReactElement {
  const source = evidence.source;
  const sourceUrl = evidence.verification.sourceUrl;
  const link = sourceUrl && /^https?:\/\//i.test(sourceUrl) ? sourceUrl : null;
  return (
    <Paper variant="panel" sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Chip label={evidence.status} size="small" variant="outlined" />
          <Typography variant="captionMuted">
            {source.kind} · revision {evidence.revision} · {evidence.scope}
          </Typography>
        </Stack>
        <Typography variant="body2Strong" sx={{ overflowWrap: "anywhere" }}>
          {evidence.statement}
        </Typography>
        <Typography variant="body2" sx={{ whiteSpace: "pre-line", overflowWrap: "anywhere" }}>
          {source.kind === "unverified" ? source.note : source.quote}
        </Typography>
        <Typography variant="captionMuted" sx={{ overflowWrap: "anywhere" }}>
          Source: {evidence.verification.sourceRecord}
          {evidence.verification.authorLogin &&
            ` · GitHub author ${evidence.verification.authorLogin}`}
        </Typography>
        {link && (
          <Link href={link} target="_blank" rel="noopener noreferrer" variant="body2">
            Open source
          </Link>
        )}
        <Typography variant="body2Muted">
          {evidence.review.claimType.replaceAll("_", " ")} ·{" "}
          {evidence.review.context.replaceAll("_", " ")}: {evidence.review.rationale}
        </Typography>
        <Typography variant="captionMuted">{evidence.verification.limitation}</Typography>
        {evidence.optionalQuestion && (
          <Alert severity="info">Optional for later: {evidence.optionalQuestion}</Alert>
        )}
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            color="warning"
            onClick={onRetract}
            disabled={busy || evidence.status === "retracted"}
          >
            Retract from future rewrites
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

export function EvidencePanel({ resumeId }: EvidencePanelProps): ReactElement {
  const params = useSearchParams();
  const status = RESUME_EVIDENCE_STATUSES.find((value) => value === params.get("evidenceStatus"));
  const pagination = usePaginationParams({ prefix: "evidence" });
  const query = useApiQuery(
    resumeQueries.evidence(resumeId, { ...pagination.query, ...(status && { status }) }),
  );
  const retract = useApiMutation(
    (evidence: ResumeEvidence) =>
      api
        .resumes({ id: resumeId })
        .evidence({ evidenceId: evidence.id })
        .delete(undefined, { query: { revision: evidence.revision } }),
    {
      successMessage: "Evidence retracted from future rewrites",
      invalidate: [queryKeys.resume.evidence(resumeId)],
      showErrorToast: false,
    },
  );
  return (
    <SectionCard
      title="Reusable evidence"
      description="Supported evidence can inform future rewrites. Unverified and retracted claims stay out of generated content. Saved documents keep the evidence they used."
    >
      <Stack spacing={2}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          <SelectField
            label="Status"
            value={status ?? null}
            emptyLabel="All statuses"
            options={RESUME_EVIDENCE_STATUSES.map((value) => ({ value, label: value }))}
            onChange={(value) => pagination.setFilters({ evidenceStatus: value })}
          />
          <Button onClick={() => void query.refetch()} disabled={query.isFetching}>
            Refresh evidence
          </Button>
        </Stack>
        {query.isLoading && <LinearProgress />}
        {query.error && (
          <Alert severity="error">
            Could not load saved evidence. Use Refresh evidence to retry.
          </Alert>
        )}
        {retract.error && (
          <Alert severity="error">{retract.error.message} Refresh evidence before retrying.</Alert>
        )}
        {query.data?.items.length === 0 && (
          <Typography variant="body2Muted">
            No evidence records match this view. The agent can gather supported details during a
            rewrite without requiring optional answers first.
          </Typography>
        )}
        {query.data?.items.map((evidence) => (
          <EvidenceRecord
            key={evidence.id}
            evidence={evidence}
            busy={retract.isPending}
            onRetract={() => retract.mutate(evidence)}
          />
        ))}
        {query.data && (
          <PaginationFooter
            pagination={query.data.pagination}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
          />
        )}
      </Stack>
    </SectionCard>
  );
}
