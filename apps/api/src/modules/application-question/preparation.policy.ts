import type {
  ApplicationPreparation,
  PreparationResultInput,
} from "@openapply/contracts/application-preparation";
import type { ApplicationQuestionView } from "@openapply/contracts/application-question";
import { conflict } from "@/common/errors";

const unsupportedControl =
  /captcha|password|passphrase|\b(?:otp|2fa|mfa)\b|one[\s-]?time.*(?:code|password)|(?:verification|security|authentication|access)[\s_-]*code/i;

export function assertOmittedField(
  question: ApplicationQuestionView,
  field: PreparationResultInput["fields"][number],
  documentFields: ApplicationPreparation["documentFields"],
) {
  const definition = question.definition;
  const control = definition.fields.find((candidate) => candidate.key === field.fieldKey);
  if (
    !question.current ||
    definition.required !== "optional" ||
    definition.visibility !== "visible" ||
    definition.condition.state !== "unconditional" ||
    definition.condition.rules.length ||
    !control ||
    control.type === "file" ||
    control.type === "unknown" ||
    (["single_choice", "multi_choice"].includes(control.type) && !control.options.length) ||
    control.options.some((option) => option.freeText && option.freeText !== "none") ||
    unsupportedControl.test(
      [definition.prompt, definition.description, control.key, control.label].join(" "),
    ) ||
    question.answer?.values.some((answer) => answer.fieldKey === field.fieldKey) ||
    documentFields.some(
      (document) =>
        document.questionId === question.id &&
        document.fieldKey === field.fieldKey &&
        document.selection !== null,
    ) ||
    field.value !== undefined ||
    field.pdfSha256 !== undefined
  )
    throw conflict("Only an unanswered, visible, unconditional optional field can be omitted.");
  // Native control identity and blank/default state are observed by the bounded browser
  // adapter. This declaration never supplies an answer or independently verifies the form.
}
