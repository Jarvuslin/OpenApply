"use client";

import { type ReactElement, useState } from "react";
import {
  Alert,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { ResumeData } from "@openapply/contracts/resume";
import type { UserWithAutoApplyInput } from "@openapply/contracts/user";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { apiErrorMessage } from "@/api/error";
import { useApiQuery } from "@/api/hooks";
import { resumeQueries } from "@/api/queries";
import { queryKeys } from "@/api/query-keys";
import { useTerminalHealth } from "@/components/features/agent-dock/use-terminal-health";
import { extractUpload } from "@/components/features/resumes/extract-upload";
import { Dialog, DialogTitle } from "@/components/ui/feedback";
import { FileUpload } from "@/components/ui/form";
import { MAX_RESUME_BYTES } from "@/lib/constants";
import { useAgentDock } from "@/providers/agent-provider";
import { resumeHistoryAdditions, resumeProfileChanges } from "./resume-profile-changes";

interface ResumeImportDialogProps {
  values: UserWithAutoApplyInput;
  /** Saves the blank contact fields, new jobs and new schools to the profile. */
  onImport: (change: Partial<UserWithAutoApplyInput>) => Promise<void>;
  onClose: () => void;
}

export function ResumeImportDialog(props: ResumeImportDialogProps): ReactElement {
  const { values, onImport, onClose } = props;
  const list = useApiQuery(resumeQueries.list());
  const queryClient = useQueryClient();
  const { health } = useTerminalHealth();
  const { provider, expand } = useAgentDock();
  const [selectedId, setSelectedId] = useState("");
  const [uploadedName, setUploadedName] = useState("");
  const [content, setContent] = useState<ResumeData | null>(null);
  const [primaryId, setPrimaryId] = useState("");
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  const changes = content ? resumeProfileChanges(values, content.basics) : [];
  const { jobs, schools } = content
    ? resumeHistoryAdditions(values, content)
    : { jobs: [], schools: [] };
  const nothingNew = !!content && !changes.length && !jobs.length && !schools.length;
  const busy = phase !== "";

  const save = async (): Promise<void> => {
    setPhase("Saving to your profile…");
    setError("");
    try {
      await onImport({
        ...Object.fromEntries(changes.map(({ field, value }) => [field, value])),
        ...(jobs.length > 0 && { workHistory: [...(values.workHistory ?? []), ...jobs] }),
        ...(schools.length > 0 && {
          educationHistory: [...(values.educationHistory ?? []), ...schools],
        }),
        ...(primaryId !== "" && !values.primaryResumeId && { primaryResumeId: primaryId }),
      });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save. Please retry.");
    } finally {
      setPhase("");
    }
  };

  const read = async (id: string): Promise<void> => {
    setPhase("Loading saved resume…");
    setError("");
    setContent(null);
    try {
      const result = await api.resumes({ id }).get();
      if (result.error) throw new Error(apiErrorMessage(result.error));
      if (!result.data) throw new Error("Could not load this resume. Please retry.");
      if (result.data.isPrimary) setPrimaryId(id);
      if (result.data.content) {
        setContent(result.data.content);
        return;
      }
      if (!result.data.sourceFilename)
        throw new Error("This resume has no saved content or source file.");
      if (health !== "reachable") {
        throw new Error(
          "Your file is saved. Connect the local companion, then preview its fields.",
        );
      }
      setPhase(
        `Reading with ${provider === "claude" ? "Claude" : "Codex"}. This can take a minute…`,
      );
      const extracted = await extractUpload(id);
      setContent(extracted);
      void queryClient.invalidateQueries({ queryKey: queryKeys.resume.all });
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not read the resume. Please retry.",
      );
    } finally {
      setPhase("");
    }
  };

  const upload = async (file: File): Promise<void> => {
    setPhase("Uploading resume…");
    setError("");
    setContent(null);
    try {
      const result = await api.resumes.upload.post({ file });
      if (result.error) throw new Error(apiErrorMessage(result.error));
      if (!result.data) throw new Error("Upload failed. Please retry.");
      setUploadedName(file.name);
      setSelectedId(result.data.id);
      void queryClient.invalidateQueries({ queryKey: queryKeys.resume.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.user.all });
      await read(result.data.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Upload failed. Please retry.");
    } finally {
      setPhase("");
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Fill profile from resume</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2Muted">
            Fills blank contact fields and adds jobs and schools your profile doesn't list yet.
            Anything you already entered stays as it is, including work eligibility, sponsorship and
            preferences.
          </Typography>
          {list.isPending && <Typography variant="body2Muted">Loading saved resumes…</Typography>}
          {list.isError && (
            <Alert
              severity="error"
              action={<Button onClick={() => void list.refetch()}>Retry</Button>}
            >
              Could not load saved resumes.
            </Alert>
          )}
          <TextField
            select
            fullWidth
            label="Saved resume"
            value={selectedId}
            disabled={busy || list.isPending}
            onChange={(event) => {
              setSelectedId(event.target.value);
              setContent(null);
              setError("");
            }}
          >
            <MenuItem value="">Choose a resume</MenuItem>
            {(list.data ?? []).map((resume) => (
              <MenuItem key={resume.id} value={resume.id}>
                {resume.label}
              </MenuItem>
            ))}
            {selectedId && !list.data?.some((resume) => resume.id === selectedId) && (
              <MenuItem value={selectedId}>{uploadedName}</MenuItem>
            )}
          </TextField>
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
            <Button disabled={!selectedId || busy} onClick={() => void read(selectedId)}>
              Preview fields
            </Button>
            <FileUpload
              accept=".pdf,.docx,.txt"
              maxBytes={MAX_RESUME_BYTES}
              disabled={busy}
              label="Upload new resume"
              onFile={(file) => void upload(file)}
              onError={setError}
            />
          </Stack>
          <Typography variant="captionMuted">
            Uploads are saved in Documents. PDF, Word or text, up to 5 MB. Your first resume becomes
            primary automatically. Already extracted resumes reuse their saved data.
          </Typography>
          {busy && (
            <Alert icon={<CircularProgress size={18} />} severity="info">
              {phase}
            </Alert>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          {health !== "reachable" && (
            <Button onClick={expand}>Connect agent to read a new resume</Button>
          )}
          {nothingNew && (
            <Alert severity="info">
              Nothing new on this resume. Your profile already has these details.
            </Alert>
          )}
          {changes.length > 0 && (
            <Stack spacing={1.5}>
              <Typography variant="body2Strong">Fields to fill</Typography>
              {changes.map(({ field, label, value }) => (
                <Stack key={field} spacing={0.25}>
                  <Typography variant="captionMuted">{label}</Typography>
                  <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                    {value}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          )}
          {jobs.length > 0 && (
            <Stack spacing={1}>
              <Typography variant="body2Strong">Work experience to add</Typography>
              {jobs.map((job) => (
                <Typography key={`${job.company}-${job.title}`} variant="body2">
                  {job.title} · {job.company}
                  {job.start && ` · ${job.start} – ${job.end || "Present"}`}
                </Typography>
              ))}
            </Stack>
          )}
          {schools.length > 0 && (
            <Stack spacing={1}>
              <Typography variant="body2Strong">Education to add</Typography>
              {schools.map((school) => (
                <Typography key={school.school} variant="body2">
                  {[school.school, school.degree].filter(Boolean).join(" · ")}
                </Typography>
              ))}
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={busy || !content || nothingNew}
          onClick={() => void save()}
        >
          Save to profile
        </Button>
      </DialogActions>
    </Dialog>
  );
}
