"use client";
import { useState } from "react";
import { USER_DEFAULT_VALUES } from "@jobpilot/contracts/user";
import { Alert, Button, CircularProgress, Stack, Typography } from "@mui/material";
import { api } from "@/api/client";
import { apiErrorMessage } from "@/api/error";
import { extractUpload } from "@/components/features/resumes/extract-upload";
import { FileUpload } from "@/components/ui/form";
import { withForm } from "@/components/ui/form/tanstack";
import { MAX_RESUME_BYTES } from "@/lib/constants";
import { applyBasicsToForm } from "./map-basics-to-profile";

export const ResumeUploadStep = withForm({
  defaultValues: USER_DEFAULT_VALUES,
  props: { onContinue: () => {} },
  render: function ResumeUploadStep({ form, onContinue }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [done, setDone] = useState(false);
    const [uploadedId, setUploadedId] = useState(form.getFieldValue("primaryResumeId"));
    const read = async (id: string) => {
      setBusy(true);
      setError("");
      try {
        const content = await extractUpload(id);
        applyBasicsToForm(form, content.basics);
        setDone(true);
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Reading failed. Your file is saved; retry below.",
        );
      } finally {
        setBusy(false);
      }
    };
    const upload = async (file: File) => {
      setBusy(true);
      setError("");
      setDone(false);
      try {
        const uploaded = await api.resumes.upload.post({ file });
        if (uploaded.error) throw new Error(apiErrorMessage(uploaded.error));
        if (!uploaded.data) throw new Error("Upload failed. Please retry.");
        setUploadedId(uploaded.data.id);
        form.setFieldValue("primaryResumeId", uploaded.data.id);
        await read(uploaded.data.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Resume import failed.");
      } finally {
        setBusy(false);
      }
    };
    return (
      <Stack spacing={3}>
        <Stack spacing={1}>
          <Typography variant="h4">Start with your experience</Typography>
          <Typography color="text.secondary">
            Drop your resume to fill the fields we can find, or enter everything yourself. You
            review the remaining answers before applying.
          </Typography>
        </Stack>
        <FileUpload
          variant="dropzone"
          accept=".pdf,.docx,.txt"
          maxBytes={MAX_RESUME_BYTES}
          loading={busy}
          disabled={busy}
          description="PDF, Word (.docx) or text · up to 5 MB"
          onFile={(file) => void upload(file)}
          onError={setError}
        />
        {busy && (
          <Alert icon={<CircularProgress size={18} />} severity="info">
            Reading the document and structuring it with your Claude subscription. This can take a
            minute.
          </Alert>
        )}
        {error && <Alert severity="error">{error}</Alert>}
        {uploadedId && !done && (
          <Button disabled={busy} onClick={() => void read(uploadedId)}>
            Retry reading saved resume
          </Button>
        )}
        {done && (
          <Alert severity="success">
            Resume imported. Review the prefilled answers next. Your experience and education are
            available in the resume editor.
          </Alert>
        )}
        <Stack direction="row" spacing={2} sx={{ justifyContent: "flex-end" }}>
          <Button onClick={onContinue} disabled={busy}>
            Fill manually
          </Button>
          {done && (
            <Button variant="contained" onClick={onContinue}>
              Review my profile
            </Button>
          )}
        </Stack>
        <Typography variant="caption" color="text.secondary">
          Document extraction uses open-source PDF.js and Mammoth. Scanned image-only PDFs need OCR
          and are not supported in this MVP.
        </Typography>
      </Stack>
    );
  },
});
