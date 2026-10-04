"use client";
import { type ReactElement, useState } from "react";
import { DocumentScanner } from "@mui/icons-material";
import { Button } from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/api/query-keys";
import type { ResumeDto } from "@/api/types";
import { useConfirm } from "@/providers/confirm-provider";
import { useToast } from "@/providers/notification-provider";
import { extractUpload } from "./extract-upload";

interface ExtractResumeButtonProps {
  resume: ResumeDto;
  size?: "small" | "medium";
}
export function ExtractResumeButton({
  resume,
  size = "small",
}: ExtractResumeButtonProps): ReactElement {
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function run() {
    if (
      resume.content &&
      !(await confirm({
        title: "Replace extracted fields?",
        description:
          "This rereads the original file and replaces the structured fields, including your manual edits.",
        confirmLabel: "Read again",
        destructive: true,
      }))
    )
      return;
    setBusy(true);
    try {
      await extractUpload(resume.id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.resume.all });
      toast.success("Resume extracted");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Extraction failed. Your file is saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button
      size={size}
      variant="outlined"
      startIcon={<DocumentScanner />}
      disabled={busy}
      onClick={() => void run()}
    >
      {busy ? "Reading…" : resume.content ? "Read source again" : "Extract resume"}
    </Button>
  );
}
