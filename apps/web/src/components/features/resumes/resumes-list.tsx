"use client";

import { type ReactElement, useState } from "react";
import { Add, Delete, Description, PictureAsPdf, Star, StarBorder } from "@mui/icons-material";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/api/client";
import { useApiMutation, useApiQuery } from "@/api/hooks";
import { resumeQueries } from "@/api/queries";
import { invalidations } from "@/api/query-keys";
import { resumePdfUrl } from "@/api/resume-urls";
import { RelativeTime } from "@/components/ui/display";
import { FileUpload } from "@/components/ui/form";
import { SectionCard } from "@/components/ui/layout";
import { MAX_RESUME_BYTES } from "@/lib/constants";
import { useConfirm } from "@/providers/confirm-provider";
import { useToast } from "@/providers/notification-provider";
import { plural } from "@/utils/format";
import { NewResumeDialog } from "./new-resume-dialog";

export function ResumesList(): ReactElement {
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);

  const list = useApiQuery(resumeQueries.list(), {
    // One stream per resume can exhaust the browser's HTTP/1.1 connection slots.
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });

  const upload = useApiMutation<{ id: string }, File>((file) => api.resumes.upload.post({ file }), {
    successMessage: "Resume uploaded",
    invalidate: invalidations.resume,
    onSuccess: ({ id }) => {
      // The detail page uses the same local extraction endpoint as onboarding.
      router.push(`/resumes/${id}` as Route);
    },
  });

  const setPrimary = useApiMutation<{ primaryResumeId: string | null }, string>(
    (id) => api.user["primary-resume"].put({ resumeId: id }),
    {
      successMessage: "Primary resume updated",
      invalidate: invalidations.resume,
    },
  );

  const remove = useApiMutation<{ deleted: string }, string>((id) => api.resumes({ id }).delete(), {
    successMessage: "Resume deleted",
    invalidate: invalidations.resume,
  });

  const handleDelete = async (id: string, label: string, isPrimary: boolean): Promise<void> => {
    const primaryNote = isPrimary
      ? " This is your primary resume; you can choose another after deleting it."
      : "";
    const confirmed = await confirm({
      title: "Delete resume?",
      description: `Remove "${label}", its uploaded file and all its variants? This cannot be undone.${primaryNote}`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (confirmed) remove.mutate(id);
  };

  if (list.isLoading) {
    return <LinearProgress />;
  }
  const rows = list.data ?? [];

  return (
    <Stack spacing={2}>
      <Stack
        component={Paper}
        variant="panel"
        direction="row"
        spacing={1.5}
        sx={{ alignItems: "center", p: 2, borderStyle: "dashed" }}
      >
        <FileUpload
          accept=".pdf,.docx,.txt"
          maxBytes={MAX_RESUME_BYTES}
          loading={upload.isPending}
          label="Upload resume"
          buttonProps={{ variant: "contained" }}
          onFile={(f) => upload.mutate(f)}
          onError={(msg) => toast.error(msg)}
        />
        <Button
          variant="outlined"
          size="small"
          startIcon={<Add />}
          onClick={() => setDialogOpen(true)}
        >
          Start blank
        </Button>
        <Typography variant="captionMuted" sx={{ ml: "auto" }}>
          {plural(rows.length, "resume")}
        </Typography>
      </Stack>

      {rows.length === 0 ? (
        <SectionCard title="No resumes yet">
          <Typography variant="body2Muted">
            Upload a PDF to bootstrap your first base resume, or start blank and fill out the
            editor.
          </Typography>
        </SectionCard>
      ) : (
        <Stack spacing={1}>
          {rows.map((r) => (
            <Card key={r.id} sx={{ backgroundColor: r.isPrimary ? "action.selected" : undefined }}>
              <CardContent>
                <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
                  <Description fontSize="lg" sx={{ color: "text.secondary" }} />
                  <Box
                    component={Link}
                    href={`/resumes/${r.id}` as Route}
                    sx={{ flex: 1, minWidth: 0, textDecoration: "none", color: "inherit" }}
                  >
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                      <Typography variant="body1Strong">{r.label}</Typography>
                      {r.isPrimary && <Chip label="Primary" size="small" color="primary" />}
                      {!r.hasData && <Chip label="No structure" size="small" variant="outlined" />}
                      {r.variantCount > 0 && (
                        <Chip
                          label={`${r.variantCount} variant${r.variantCount === 1 ? "" : "s"}`}
                          size="small"
                          variant="outlined"
                        />
                      )}
                    </Stack>
                    <Typography variant="captionMuted">
                      {r.sourceFilename ?? "no source PDF"} · updated{" "}
                      <RelativeTime value={r.updatedAt} />
                    </Typography>
                  </Box>
                  <IconButton
                    onClick={() => setPrimary.mutate(r.id)}
                    aria-label={r.isPrimary ? "Primary resume" : "Set as primary"}
                    disabled={setPrimary.isPending || remove.isPending}
                  >
                    {r.isPrimary ? <Star fontSize="md" /> : <StarBorder fontSize="md" />}
                  </IconButton>
                  <IconButton
                    component="a"
                    href={resumePdfUrl(r.id, r.updatedAt)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Open PDF"
                  >
                    <PictureAsPdf fontSize="md" />
                  </IconButton>
                  <IconButton
                    aria-label={`Delete ${r.label}`}
                    title="Delete resume"
                    disabled={remove.isPending || setPrimary.isPending}
                    loading={remove.isPending && remove.variables === r.id}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void handleDelete(r.id, r.label, r.isPrimary);
                    }}
                  >
                    <Delete fontSize="md" />
                  </IconButton>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      <NewResumeDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </Stack>
  );
}
