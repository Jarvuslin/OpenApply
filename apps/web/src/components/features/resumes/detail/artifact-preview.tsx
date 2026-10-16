"use client";

import type { ReactElement } from "react";
import { Alert, Button, Paper, Stack, Typography } from "@mui/material";
import { API_BASE_URL } from "@/api/base-url";
import { api } from "@/api/client";
import { useApiMutation, useApiQuery } from "@/api/hooks";
import { resumeQueries } from "@/api/queries";

interface ArtifactPreviewProps {
  resumeId: string;
  variantId?: string;
  updatedAt: Date | string;
  preview?: boolean;
}

/** The iframe and downloads all use the same immutable revision returned by the API. */
export function ArtifactPreview({
  resumeId,
  variantId,
  updatedAt,
  preview = true,
}: ArtifactPreviewProps): ReactElement {
  const endpoint = variantId
    ? api.resumes.variants({ id: variantId })
    : api.resumes({ id: resumeId });
  const query = resumeQueries.artifact(resumeId, variantId, updatedAt);
  const current = useApiQuery(query);
  const generate = useApiMutation(() => endpoint.artifacts.post(), {
    showErrorToast: false,
    invalidate: [query.queryKey],
  });
  const artifact = current.data?.artifact;
  const error = generate.error ?? current.error;

  return (
    <Stack spacing={1}>
      {error && <Alert severity="error">{error.message}</Alert>}
      {!artifact && !current.isLoading && (
        <Stack spacing={1}>
          <Typography variant="body2Muted">
            Generate a one-page PDF in the canonical format. Your saved content and original upload
            are retained if compilation or validation fails.
          </Typography>
          <Button
            variant="outlined"
            onClick={() => generate.mutate()}
            disabled={generate.isPending || Boolean(current.error)}
          >
            {generate.isPending ? "Compiling and validating…" : "Generate canonical PDF"}
          </Button>
        </Stack>
      )}
      {current.isLoading && (
        <Typography variant="body2Muted">Loading saved PDF revision…</Typography>
      )}
      {artifact && (
        <>
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
            <Button
              size="small"
              component="a"
              href={`${API_BASE_URL}${artifact.pdfUrl}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open exact PDF
            </Button>
            <Button
              size="small"
              component="a"
              href={`${API_BASE_URL}${artifact.texUrl}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              LaTeX source
            </Button>
            <Button
              size="small"
              component="a"
              href={`${API_BASE_URL}${artifact.metadataUrl}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Revision and evidence
            </Button>
          </Stack>
          <Typography variant="captionMuted">
            One page · {artifact.template.id} v{artifact.template.version} · revision{" "}
            {artifact.revision.slice(0, 12)}
          </Typography>
          {artifact.validation.warnings.map((warning) => (
            <Alert key={warning} severity="warning">
              {warning}
            </Alert>
          ))}
          {preview && (
            <Paper
              component="iframe"
              title="Exact saved resume PDF"
              variant="panel"
              src={`${API_BASE_URL}${artifact.pdfUrl}`}
              sx={{ width: "100%", aspectRatio: "8.5/11", bgcolor: "background.default" }}
            />
          )}
        </>
      )}
    </Stack>
  );
}
