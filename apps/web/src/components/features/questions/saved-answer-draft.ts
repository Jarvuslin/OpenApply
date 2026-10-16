import type {
  AnswerApplicationQuestion,
  ApplicationQuestionView,
} from "@openapply/contracts/application-question";
import { type AnswerDraft, prepareApplicationAnswer } from "./application-answer";

export function savedAnswerDraft(
  question: Pick<ApplicationQuestionView, "definition" | "blocking">,
  values: AnswerApplicationQuestion["values"],
): AnswerDraft {
  const draft: AnswerDraft = {};
  for (const entry of values) {
    const field = question.definition.fields.find((candidate) => candidate.key === entry.fieldKey);
    if (!field || entry.fieldKey in draft)
      throw new Error("The saved answer does not map to this exact question.");
    const expected =
      { number: "number", boolean: "boolean", multi_choice: "array" }[
        field.type as "number" | "boolean" | "multi_choice"
      ] ?? "string";
    const actual = Array.isArray(entry.value) ? "array" : typeof entry.value;
    if (expected !== actual) throw new Error("The saved answer has a different field type.");
    draft[entry.fieldKey] = Array.isArray(entry.value) ? [...entry.value] : String(entry.value);
  }
  prepareApplicationAnswer(question.definition, draft, question.blocking);
  return draft;
}
