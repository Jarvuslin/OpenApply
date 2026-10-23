"use client";

import { type ReactElement, useId, useState } from "react";
import { Alert, Button, Stack, TextField } from "@mui/material";
import type { PilotQuestion } from "@openapply/contracts/pilot";
import { MessageCircle } from "lucide-react";
import { api } from "@/api/client";
import { useApiMutation } from "@/api/hooks";
import { invalidations } from "@/api/query-keys";
import { AccountQuestionCard } from "@/components/features/account-setup/account-question-card";
import { CheckpointApprovalCard } from "@/components/features/questions/checkpoint-approval-card";
import {
  AnsweredQuestionCard,
  ChoiceRow,
  QuestionCardFrame,
  QuestionHeading,
} from "./question-card-frame";

interface QuestionCardProps {
  question: PilotQuestion;
}

export function QuestionCard(props: QuestionCardProps): ReactElement {
  const { question } = props;
  if (question.subjectType === "account_setup") return <AccountQuestionCard question={question} />;
  if (question.approval)
    return (
      <CheckpointApprovalCard
        key={question.approval.checkpointId}
        question={question}
        approval={question.approval}
      />
    );
  return <OperationalQuestionCard question={question} />;
}

const SUBJECTS: Record<PilotQuestion["kind"], string> = {
  question: "Question for you",
  choice: "Choose an answer",
  two_factor: "Verification code",
  approval: "Approval needed",
};

// The "type a different answer" row; never equal to a real option label.
const OTHER = "\u0000other";

function OperationalQuestionCard(props: QuestionCardProps): ReactElement {
  const { question } = props;
  const [freeText, setFreeText] = useState("");
  const [selection, setSelection] = useState(question.options.length > 0 ? "" : OTHER);
  const promptId = useId();
  const answer = useApiMutation<unknown, string>(
    (value) => api.pilot.questions({ id: question.id }).answer.post({ answer: value }),
    {
      invalidate: invalidations.questions,
      successMessage: "Answer sent.",
    },
  );
  const hasOptions = question.options.length > 0;
  const value = selection === OTHER ? freeText.trim() : selection;
  let sendLabel = "Send answer";
  if (!value)
    sendLabel = selection === OTHER ? "Type an answer to send" : "Choose an answer to send";
  const menu = [
    {
      kind: "item" as const,
      key: "details",
      label: "Open details",
      show: !!question.deepLink,
      onClick: () => window.open(question.deepLink ?? "", "_blank", "noopener,noreferrer"),
    },
  ];

  if (question.status === "answered" && question.answer)
    return (
      <AnsweredQuestionCard
        data-operational-question-id={question.id}
        subject={SUBJECTS[question.kind]}
        summary={`${question.prompt} → ${question.answer}`}
        note="Sent to your application"
        time={question.answeredAt ?? question.createdAt}
        menu={menu}
      />
    );

  return (
    <QuestionCardFrame
      aria-labelledby={promptId}
      data-operational-question-id={question.id}
      icon={<MessageCircle size={22} aria-hidden />}
      subject={SUBJECTS[question.kind]}
      time={question.createdAt}
      menu={menu}
      footer={
        <Button
          variant="contained"
          disabled={!value}
          loading={answer.isPending}
          onClick={() => answer.mutate(value)}
          sx={{ minHeight: 44, px: 2.5 }}
        >
          {sendLabel}
        </Button>
      }
    >
      <QuestionHeading id={promptId} prompt={question.prompt} />
      {answer.error && (
        <Alert severity="error">
          Could not send your answer. Your draft is still here; retry when ready.
        </Alert>
      )}
      <Stack spacing={1.5} role={hasOptions ? "radiogroup" : undefined} aria-labelledby={promptId}>
        {question.options.map((option) => (
          <ChoiceRow
            key={option}
            label={option}
            selected={selection === option}
            disabled={answer.isPending}
            onSelect={() => setSelection(option)}
          />
        ))}
        {hasOptions && (
          <ChoiceRow
            label="A different answer…"
            selected={selection === OTHER}
            disabled={answer.isPending}
            onSelect={() => setSelection(OTHER)}
          />
        )}
        {selection === OTHER && (
          <TextField
            fullWidth
            multiline
            minRows={hasOptions ? 1 : 2}
            size="small"
            autoFocus={hasOptions}
            value={freeText}
            disabled={answer.isPending}
            onChange={(event) => setFreeText(event.target.value)}
            placeholder="Type your answer"
            slotProps={{ htmlInput: { "aria-label": "Your answer" } }}
          />
        )}
      </Stack>
    </QuestionCardFrame>
  );
}
