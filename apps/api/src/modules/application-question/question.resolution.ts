import {
  questionAnswerValuesSchema,
  questionDefinitionSchema,
} from "@openapply/contracts/application-question";
import { isHumanAuthorship } from "@/common/auth/human-actor";
import type { ApplicationQuestion, ApplicationQuestionAnswer } from "@/generated/prisma/client";
import { applicableQuestion } from "./question.policy";

export function questionBlockers(
  rows: (ApplicationQuestion & { answers: ApplicationQuestionAnswer[] })[],
  documents: Map<string, Set<string>>,
) {
  const values = new Map<string, string | number | boolean | string[]>();
  for (const row of rows) {
    const answer = row.answers[0];
    if (!answer?.confirmedAt || !isHumanAuthorship(answer.authorship)) continue;
    for (const entry of questionAnswerValuesSchema.parse(answer.values))
      values.set(entry.fieldKey, entry.value);
  }
  return new Map(
    rows.map((row) => {
      const definition = questionDefinitionSchema.parse(row.definition);
      const answer = row.answers[0];
      const fields = new Set(documents.get(row.id));
      if (answer?.confirmedAt && isHumanAuthorship(answer.authorship))
        for (const value of questionAnswerValuesSchema.parse(answer.values))
          fields.add(value.fieldKey);
      const resolved =
        definition.groupMode === "any"
          ? definition.fields.some((field) => fields.has(field.key))
          : definition.fields.every((field) => fields.has(field.key));
      return [row.id, !resolved && applicableQuestion(definition, values)] as const;
    }),
  );
}
