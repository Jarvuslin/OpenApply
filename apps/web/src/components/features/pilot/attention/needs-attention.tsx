"use client";
import type { ReactElement } from "react";
import { Chip, Stack } from "@mui/material";
import { EmptyState, QuerySection } from "@/components/ui/data";
import { SectionCard } from "@/components/ui/layout";
import { QuestionCard } from "./question-card";
import { useOpenQuestions } from "./use-open-questions";
export function NeedsAttention(): ReactElement {
  const query = useOpenQuestions();
  const { questions } = query;
  return (
    <SectionCard
      title="Needs attention"
      actions={
        questions.length > 0 && <Chip size="small" color="warning" label={questions.length} />
      }
    >
      <QuerySection
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={query.refetch}
        errorTitle="Couldn't load what needs your attention."
        isEmpty={questions.length === 0}
        empty={<EmptyState variant="inline" title="Nothing needs your attention." />}
      >
        <Stack spacing={2}>
          {questions.map((question) => (
            <QuestionCard key={question.id} question={question} />
          ))}
        </Stack>
      </QuerySection>
    </SectionCard>
  );
}
