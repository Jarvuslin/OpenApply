"use client";

import { type ReactElement, useId, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Divider,
  FormControlLabel,
  LinearProgress,
  Stack,
} from "@mui/material";
import type { UseSavedAnswer } from "@openapply/contracts/answer-bank-input";
import {
  type ApplicationQuestionView,
  answerApplicationQuestionSchema,
  type JobQuestions,
} from "@openapply/contracts/application-question";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { api } from "@/api/client";
import { ApiError } from "@/api/error";
import { useApiQuery } from "@/api/hooks";
import { userQueries } from "@/api/queries";
import { invalidations } from "@/api/query-keys";
import { questionQueries } from "@/api/question-queries";
import { useSession } from "@/hooks/use-auth";
import { queueRequests, sendQueueRequest } from "@/lib/queue-request";
import {
  type AnswerDraft,
  prepareApplicationAnswer,
  questionNeedsInspection,
} from "./application-answer";
import { selectedDocumentFieldKeys } from "./document-choice";
import { needsAnswerCountry, questionBankInput } from "./question-bank-input";
import { QuestionCardFrame, QuestionHeading } from "./question-card-frame";
import { QuestionDocuments } from "./question-documents";
import { QuestionFields } from "./question-fields";
import { savedAnswerDraft } from "./saved-answer-draft";
import { SavedAnswerMatches } from "./saved-answer-matches";

interface ApplicationQuestionCardProps {
  question: ApplicationQuestionView;
  job: JobQuestions["job"];
}

export function ApplicationQuestionCard(props: ApplicationQuestionCardProps): ReactElement {
  const { question, job } = props;
  const { user } = useSession();
  const client = useQueryClient();
  const promptId = useId();
  const [basis, setBasis] = useState(question.definitionHash);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState("");
  // A remembered answer is scoped to the country in the person's profile; they never pick it here.
  const profile = useApiQuery(userQueries.detail());
  const countryCode = profile.data?.user.countryCode ?? "";
  const countryConfirmed = /^[A-Z]{2}$/.test(countryCode);
  const [selectedSaved, setSelectedSaved] = useState<UseSavedAnswer | null>(null);
  const stale = conflict || basis !== question.definitionHash;
  const inspection = questionNeedsInspection(question.definition, question.blocking);
  const hasFile = question.definition.fields.some((field) => field.type === "file");
  const hasFactualFields = question.definition.fields.some(
    (field) => field.type !== "file" && field.type !== "unknown",
  );
  const preparation = useApiQuery(questionQueries.preparation(job.id), { enabled: hasFile });
  const selectedFiles = selectedDocumentFieldKeys(question, preparation.data);
  const unsupported = question.definition.fields.filter(
    (field) =>
      (field.type === "file" && !selectedFiles.includes(field.key)) || field.type === "unknown",
  );
  const requiresBrowser =
    inspection ||
    (question.definition.groupMode === "all" && unsupported.length > 0) ||
    unsupported.length === question.definition.fields.length;
  const form = useForm({
    defaultValues: {
      draft: {} as AnswerDraft,
      confirmed: false,
    },
    onSubmit: async ({ value }) => {
      if (!value.confirmed || stale || requiresBrowser) return;
      setError("");
      try {
        const input = {
          expectedRevision: question.revision,
          expectedDefinitionHash: question.definitionHash,
          confirmed: true as const,
          values: prepareApplicationAnswer(
            question.definition,
            value.draft,
            question.blocking,
            selectedFiles,
          ),
          ...questionBankInput(
            question,
            {
              // Every confirmed answer is remembered; a country-bound one only once its country is confirmed.
              save:
                !needsAnswerCountry(question.category) ||
                (countryConfirmed && /^[A-Z]{2}$/.test(countryCode)),
              scope: question.category === "other" ? "employer" : "account",
              countryCode,
              countryConfirmed,
            },
            selectedSaved,
          ),
        };
        await sendQueueRequest(
          queueRequests,
          user?.id ?? "",
          ["question-answer", question.id, input],
          async (requestId) => {
            const payload = answerApplicationQuestionSchema.parse({ ...input, requestId });
            const result = await api["application-questions"]({ id: question.id }).answers.post(
              payload,
            );
            if (result.error) throw new ApiError(result.error);
            return result.data;
          },
        );
        for (const queryKey of invalidations.questions)
          await client.invalidateQueries({ queryKey });
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not save your answer. Your draft is still here.",
        );
        if (reason instanceof ApiError && reason.status === 409) {
          setConflict(true);
          form.setFieldValue("confirmed", false);
          for (const queryKey of invalidations.questions)
            void client.invalidateQueries({ queryKey });
        }
      }
    },
  });
  return (
    <QuestionCardFrame
      aria-labelledby={promptId}
      data-application-question-id={question.id}
      icon={<MessageCircle size={22} aria-hidden />}
      subject={`${job.title} · ${job.company}`}
      time={question.observedAt}
      menu={[
        {
          kind: "item",
          key: "job",
          label: "View job details",
          onClick: () => window.location.assign(`/campaigns/${job.campaignId}`),
        },
        {
          kind: "item",
          key: "source",
          label: "View question source",
          onClick: () => window.open(question.sourceUrl, "_blank", "noopener,noreferrer"),
        },
      ]}
    >
      <QuestionHeading
        id={promptId}
        prompt={question.definition.prompt}
        detail={
          question.definition.groupMode === "any"
            ? [question.definition.description, "Answer at least one alternative."]
                .filter(Boolean)
                .join("\n")
            : question.definition.description
        }
      />
      {!inspection && question.definition.visibility === "hidden" && (
        <Alert severity="info">
          This field was hidden when observed and has a recorded condition. You can confirm its
          factual answer here. The server still checks the controlling answers and remaining form
          requirements.
        </Alert>
      )}
      {requiresBrowser && (!hasFile || inspection) && (
        <Alert severity="warning">
          This question needs browser inspection. Open the job details to collect its current form;
          it remains unresolved until its requirements are known.
        </Alert>
      )}
      {hasFile && preparation.isLoading && (
        <LinearProgress aria-label="Loading document requirements" />
      )}
      {hasFile && preparation.error && (
        <Alert
          severity="error"
          action={
            <Button onClick={() => void preparation.refetch()}>Retry document requirements</Button>
          }
        >
          Could not verify this upload requirement.
        </Alert>
      )}
      {hasFile && preparation.data && (
        <QuestionDocuments
          question={question}
          preparation={preparation.data}
          disabled={inspection}
        />
      )}
      {stale && (
        <Alert
          severity="warning"
          action={
            <Button
              onClick={() => {
                form.reset();
                setBasis(question.definitionHash);
                setConflict(false);
                setError("");
                setSelectedSaved(null);
              }}
            >
              Review updated question
            </Button>
          }
        >
          The form changed or this revision could not be confirmed. Your draft has not been sent.
          Review the latest question before entering a new answer.
        </Alert>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {hasFactualFields && (
        <Box
          component="form"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <Stack spacing={2}>
            <SavedAnswerMatches
              key={`${question.definitionHash}:${countryCode}:${countryConfirmed}`}
              question={question}
              countryCode={countryCode}
              countryConfirmed={countryConfirmed}
              disabled={stale || requiresBrowser}
              onConflict={() => {
                setConflict(true);
                form.setFieldValue("confirmed", false);
                for (const queryKey of invalidations.questions)
                  void client.invalidateQueries({ queryKey });
              }}
              onUse={(match) => {
                try {
                  form.setFieldValue("draft", savedAnswerDraft(question, match.mappedValues));
                  form.setFieldValue("confirmed", false);
                  setSelectedSaved({ entryId: match.entryId, revision: match.revision });
                  setError("");
                } catch (reason) {
                  setError(
                    reason instanceof Error ? reason.message : "Could not use this saved answer.",
                  );
                }
              }}
            />
            {selectedSaved && (
              <Alert severity="info">
                Saved revision {selectedSaved.revision} filled the draft. Confirm its accuracy for
                this application before saving.
              </Alert>
            )}
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(busy) => (
                <form.Field name="draft">
                  {(field) => (
                    <QuestionFields
                      definition={question.definition}
                      draft={field.state.value}
                      disabled={busy || stale || requiresBrowser}
                      onChange={(draft) => {
                        field.handleChange(draft);
                        form.setFieldValue("confirmed", false);
                        setSelectedSaved(null);
                      }}
                    />
                  )}
                </form.Field>
              )}
            </form.Subscribe>
            <Divider />
            <Stack
              direction="row"
              spacing={1.5}
              sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1.5 }}
            >
              <form.Field name="confirmed">
                {(field) => (
                  <FormControlLabel
                    label="This answer is accurate for this application"
                    sx={{ flex: 1, minWidth: 0, mr: 0 }}
                    control={
                      <Checkbox
                        checked={field.state.value}
                        disabled={stale || requiresBrowser}
                        onChange={(_, checked) => field.handleChange(checked)}
                      />
                    }
                  />
                )}
              </form.Field>
              <form.Subscribe
                selector={(state) => [state.isSubmitting, state.values.confirmed] as const}
              >
                {([busy, confirmed]) => (
                  <Button
                    type="submit"
                    variant="contained"
                    loading={busy}
                    disabled={!confirmed || stale || requiresBrowser}
                    sx={{ minHeight: 44, px: 2.5, ml: "auto" }}
                  >
                    Send answer
                  </Button>
                )}
              </form.Subscribe>
            </Stack>
          </Stack>
        </Box>
      )}
    </QuestionCardFrame>
  );
}
