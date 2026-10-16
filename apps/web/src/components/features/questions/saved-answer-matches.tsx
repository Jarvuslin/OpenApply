"use client";

import type { ReactElement } from "react";
import { Alert, Button, Stack, Typography } from "@mui/material";
import type { AnswerMatches } from "@openapply/contracts/answer-bank";
import type { ApplicationQuestionView } from "@openapply/contracts/application-question";
import { api } from "@/api/client";
import { ApiError } from "@/api/error";
import { useApiMutation } from "@/api/hooks";
import { needsAnswerCountry } from "./question-bank-input";

interface SavedAnswerMatchesProps {
  question: ApplicationQuestionView;
  countryCode: string;
  countryConfirmed: boolean;
  disabled: boolean;
  onUse: (match: AnswerMatches["matches"][number]) => void;
  onConflict: () => void;
}

export function SavedAnswerMatches(props: SavedAnswerMatchesProps): ReactElement {
  const { question, countryCode, countryConfirmed, disabled, onUse, onConflict } = props;
  const countryRequired = needsAnswerCountry(question.category);
  const ready = !countryRequired || (!!countryCode && countryConfirmed);
  const lookup = useApiMutation<AnswerMatches, void>(
    () =>
      api["application-questions"]({ id: question.id })["answer-matches"].post({
        expectedRevision: question.revision,
        expectedDefinitionHash: question.definitionHash,
        ...(countryRequired && { countryCode, countryConfirmed: true as const }),
      }),
    {
      retry: false,
      showErrorToast: false,
      onError: (error) => {
        if (error instanceof ApiError && error.status === 409) onConflict();
      },
    },
  );
  return (
    <Stack spacing={1}>
      <Button
        variant="outlined"
        disabled={disabled || !ready}
        loading={lookup.isPending}
        onClick={() => lookup.mutate()}
      >
        Find saved answers
      </Button>
      {!ready && (
        <Typography variant="body2" color="text.secondary">
          Choose and confirm the question’s country to check saved answers.
        </Typography>
      )}
      {lookup.error && <Alert severity="error">{lookup.error.message}</Alert>}
      {lookup.data && lookup.data.status !== "matched" && (
        <Alert severity="info">
          {lookup.data.reason ||
            "No single compatible saved answer is available. Enter your answer directly."}
        </Alert>
      )}
      {lookup.data?.status === "matched" &&
        lookup.data.matches.map((match) => (
          <Stack
            key={`${match.entryId}:${match.revision}`}
            spacing={1}
            data-answer-bank-match={match.entryId}
          >
            <Typography variant="body2">
              Saved answer · revision {match.revision} · {match.countryCode || "No country scope"} ·{" "}
              {match.scope === "account" ? "Your account" : match.employerKey}
              {match.roleKey && ` · ${match.roleKey}`}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Confirmed {new Date(match.sourceConfirmedAt).toLocaleString()}. Review the values
              before confirming this application.
            </Typography>
            <Button disabled={disabled} onClick={() => onUse(match)}>
              Use saved answer
            </Button>
          </Stack>
        ))}
    </Stack>
  );
}
