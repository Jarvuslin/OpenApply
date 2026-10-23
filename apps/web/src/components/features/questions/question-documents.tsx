"use client";

import { type ReactElement, useState } from "react";
import { Alert, Button, Link, Stack, Typography } from "@mui/material";
import type {
  ApplicationPreparation,
  DocumentSelection,
} from "@openapply/contracts/application-preparation";
import { selectQuestionDocumentSchema } from "@openapply/contracts/application-preparation";
import type { ApplicationQuestionView } from "@openapply/contracts/application-question";
import { useQueryClient } from "@tanstack/react-query";
import { API_BASE_URL } from "@/api/base-url";
import { api } from "@/api/client";
import { ApiError } from "@/api/error";
import { invalidations } from "@/api/query-keys";
import { useSession } from "@/hooks/use-auth";
import { queueRequests, sendQueueRequest } from "@/lib/queue-request";
import { type DocumentChoice, documentChoiceInput } from "./document-choice";
import { ResumePdfPicker } from "./resume-pdf-picker";

interface QuestionDocumentsProps {
  question: ApplicationQuestionView;
  preparation: ApplicationPreparation;
  disabled: boolean;
}

export function QuestionDocuments(props: QuestionDocumentsProps): ReactElement {
  const { question, preparation, disabled } = props;
  return (
    <Stack spacing={2}>
      {question.definition.fields
        .filter((field) => field.type === "file")
        .map((field) => {
          const document = preparation.documentFields.find(
            (item) => item.questionId === question.id && item.fieldKey === field.key,
          );
          return (
            <Stack key={field.key} spacing={1} data-document-field-key={field.key}>
              <Typography variant="subtitle1" component="p">
                {field.label || question.definition.prompt}
              </Typography>
              {document?.purpose !== "resume" && (
                <Alert severity="warning">
                  {document?.reason ||
                    "This upload type needs inspection. A resume PDF cannot be substituted for an unknown document."}
                </Alert>
              )}
              {document?.purpose === "resume" && (
                <DocumentSelectionControl
                  key={`${question.id}:${question.revision}:${question.definitionHash}`}
                  question={question}
                  preparation={preparation}
                  fieldKey={field.key}
                  selection={document.selection}
                  disabled={disabled}
                />
              )}
            </Stack>
          );
        })}
    </Stack>
  );
}

interface DocumentSelectionControlProps extends QuestionDocumentsProps {
  fieldKey: string;
  selection: DocumentSelection | null;
}

function DocumentSelectionControl(props: DocumentSelectionControlProps): ReactElement {
  const { question, preparation, fieldKey, selection, disabled } = props;
  const { user } = useSession();
  const client = useQueryClient();
  const [basis, setBasis] = useState(selection?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState(0);
  const stale = conflict || basis !== (selection?.id ?? null);
  async function select(choice: DocumentChoice): Promise<void> {
    if (busy || disabled || stale) return;
    setBusy(true);
    setError("");
    try {
      const input = documentChoiceInput(question, preparation, fieldKey, choice, true);
      const saved = await sendQueueRequest(
        queueRequests,
        user?.id ?? "",
        ["question-document", question.id, input],
        async (requestId) => {
          const result = await api["application-questions"]({ id: question.id })[
            "document-selection"
          ].post(selectQuestionDocumentSchema.parse({ ...input, requestId }));
          if (result.error) throw new ApiError(result.error);
          return result.data;
        },
      );
      if (
        !saved ||
        saved.pdfSha256 !== choice.pdfSha256 ||
        saved.artifactRevision !== choice.artifactRevision
      )
        throw new Error("The saved PDF identity changed. Refresh and review this selection.");
      setBasis(saved.id);
      setReview((value) => value + 1);
      for (const queryKey of invalidations.questions) await client.invalidateQueries({ queryKey });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save this PDF selection.");
      if (reason instanceof ApiError && reason.status === 409) {
        setConflict(true);
        for (const queryKey of invalidations.questions) void client.invalidateQueries({ queryKey });
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack spacing={1.5}>
      {selection && (
        <Stack spacing={0.5}>
          <Typography variant="body2">
            PDF selected {new Date(selection.confirmedAt).toLocaleString()}
          </Typography>
          <Typography variant="caption" sx={{ overflowWrap: "anywhere" }}>
            Revision {selection.artifactRevision} · SHA-256 {selection.pdfSha256}
          </Typography>
          {selection.available && (
            <Link
              href={`${API_BASE_URL}${selection.pdfUrl}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open selected exact PDF
            </Link>
          )}
          {!selection.available && (
            <Alert severity="warning">
              {selection.unavailableReason ||
                "This PDF selection is no longer available. Choose a current owned revision."}
            </Alert>
          )}
        </Stack>
      )}
      {stale && (
        <Alert
          severity="warning"
          action={
            <Button
              onClick={() => {
                setBasis(selection?.id ?? null);
                setConflict(false);
                setError("");
                setReview((value) => value + 1);
              }}
            >
              Review current upload requirement
            </Button>
          }
        >
          The question or document selection changed. Review it before choosing another PDF.
        </Alert>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      <ResumePdfPicker key={review} disabled={disabled || stale} busy={busy} onSelect={select} />
    </Stack>
  );
}
