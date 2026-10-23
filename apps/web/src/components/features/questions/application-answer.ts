import type {
  AnswerApplicationQuestion,
  QuestionDefinition,
} from "@openapply/contracts/application-question";

export type AnswerDraft = Record<string, string | string[]>;

export function questionNeedsInspection(
  definition: QuestionDefinition,
  blocking: boolean,
): boolean {
  const knownHiddenBlocker =
    blocking && definition.visibility === "hidden" && definition.condition.state === "known";
  return (
    definition.condition.state === "unknown" ||
    (definition.visibility !== "visible" && !knownHiddenBlocker)
  );
}

export function prepareApplicationAnswer(
  definition: QuestionDefinition,
  draft: AnswerDraft,
  blocking = false,
  selectedDocumentFields: readonly string[] = [],
): AnswerApplicationQuestion["values"] {
  if (questionNeedsInspection(definition, blocking)) {
    throw new Error("This question needs browser inspection before it can be answered here.");
  }
  const values: AnswerApplicationQuestion["values"] = [];
  for (const field of definition.fields) {
    const raw = draft[field.key];
    if (field.type === "file" && selectedDocumentFields.includes(field.key)) {
      if (raw !== undefined && raw !== "")
        throw new Error("PDF selections cannot be confirmed as text answers.");
      continue;
    }
    const missing = raw === undefined || raw === "" || (Array.isArray(raw) && raw.length === 0);
    if (missing) {
      if (definition.groupMode === "all")
        throw new Error(`Answer ${field.label || definition.prompt} before confirming.`);
      continue;
    }
    if (field.type === "file" || field.type === "unknown")
      throw new Error("This field requires browser inspection.");
    if (field.type === "multi_choice") {
      if (
        !Array.isArray(raw) ||
        raw.some((value) => !field.options.some((option) => option.value === value))
      )
        throw new Error("Choose only the options provided by this form.");
      values.push({ fieldKey: field.key, value: [...new Set(raw)].sort() });
      continue;
    }
    if (typeof raw !== "string") throw new Error("Enter a single value for this field.");
    if (field.type === "single_choice" && !field.options.some((option) => option.value === raw))
      throw new Error("Choose an option provided by this form.");
    let value: string | number | boolean = field.type === "single_choice" ? raw : raw.trim();
    if (field.type === "boolean") {
      if (raw !== "true" && raw !== "false") throw new Error("Choose Yes or No explicitly.");
      value = raw === "true";
    } else if (field.type === "number") {
      if (!raw.trim() || !Number.isFinite(Number(raw))) throw new Error("Enter a valid number.");
      value = Number(raw);
    } else if (
      field.type === "date" &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(raw) ||
        !Number.isFinite(Date.parse(raw)) ||
        new Date(raw).toISOString().slice(0, 10) !== raw)
    ) {
      throw new Error("Enter a date in YYYY-MM-DD format.");
    } else if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
      throw new Error("Enter a valid email address.");
    }
    if (value === "") throw new Error("Enter an answer before confirming.");
    values.push({ fieldKey: field.key, value });
  }
  if (!values.length) throw new Error("Answer at least one of the alternatives before confirming.");
  return values.sort((left, right) => left.fieldKey.localeCompare(right.fieldKey));
}
