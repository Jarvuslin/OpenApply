import type {
  AnswerApplicationQuestion,
  QuestionDefinition,
} from "@openapply/contracts/application-question";
import { sha256 } from "@/common/crypto/hash";
import { badRequest } from "@/common/errors";

export function questionHash(value: unknown): string {
  return sha256(JSON.stringify(value));
}

export function questionCategory(definition: QuestionDefinition) {
  const prompt = definition.prompt.toLowerCase();
  if (/sponsor|sponsorship/.test(prompt)) return "sponsorship" as const;
  if (/authori[sz](ed|ation).*work|legally.*work|work.*authori[sz]/.test(prompt))
    return "authorization" as const;
  if (/disabilit/.test(prompt)) return "disability" as const;
  if (/veteran/.test(prompt)) return "veteran" as const;
  if (/gender|ethnic|race\b/.test(prompt)) return "demographic" as const;
  if (definition.fields.some((field) => field.type === "file")) return "document" as const;
  if (definition.fields.some((field) => ["email", "phone"].includes(field.type)))
    return "contact" as const;
  if (
    definition.prompt.normalize("NFC").trim().replace(/\s+/g, " ") ===
      "Preferred contact method?" &&
    definition.fields.length === 1 &&
    definition.fields[0]?.type === "single_choice" &&
    definition.fields[0].options.length === 2 &&
    definition.fields[0].options.some((option) => option.label === "Email") &&
    definition.fields[0].options.some((option) => option.label === "Phone")
  )
    return "contact" as const;
  return "other" as const;
}

export function validateAnswer(
  definition: QuestionDefinition,
  values: AnswerApplicationQuestion["values"],
  selectedFields: Set<string> = new Set(),
) {
  const keys = new Set<string>();
  for (const entry of values) {
    if (keys.has(entry.fieldKey)) throw badRequest("An answer field was repeated.");
    keys.add(entry.fieldKey);
    const field = definition.fields.find((candidate) => candidate.key === entry.fieldKey);
    if (!field) throw badRequest("Answer contains a field outside this question revision.");
    const value = entry.value;
    if (field.options.some((option) => option.freeText && option.freeText !== "none"))
      throw badRequest(
        "This question has unresolved free-text option requirements; inspect it in the browser.",
      );
    if (["file", "unknown"].includes(field.type))
      throw badRequest("This field requires browser inspection; it cannot be confirmed as text.");
    if (field.type === "number") {
      if (typeof value !== "number") throw badRequest("A numeric answer is required.");
    } else if (field.type === "boolean") {
      if (typeof value !== "boolean") throw badRequest("A boolean answer is required.");
    } else if (field.type === "multi_choice") {
      if (
        !Array.isArray(value) ||
        !value.length ||
        new Set(value).size !== value.length ||
        value.some((option) => !field.options.some((candidate) => candidate.value === option))
      )
        throw badRequest("Select exact available options without duplicates.");
    } else {
      if (typeof value !== "string" || !value.trim())
        throw badRequest("A nonempty text answer is required.");
      if (field.type === "single_choice" && !field.options.some((option) => option.value === value))
        throw badRequest("Select an exact available option.");
      if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
        throw badRequest("Enter an email address.");
      if (
        field.type === "date" &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          Number.isNaN(Date.parse(value)) ||
          new Date(value).toISOString().slice(0, 10) !== value)
      )
        throw badRequest("Enter a valid date in YYYY-MM-DD format.");
    }
  }
  if (
    definition.groupMode === "all" &&
    definition.fields.some((field) => !keys.has(field.key) && !selectedFields.has(field.key))
  )
    throw badRequest("Answer every field in this group.");
}

export function resolvedConditions(definitions: QuestionDefinition[]) {
  const owners = new Map(
    definitions.flatMap((definition) =>
      definition.fields.map((field) => [field.key, definition] as const),
    ),
  );
  function resolved(definition: QuestionDefinition, visiting: Set<string>): boolean {
    if (visiting.has(definition.stableKey)) return false;
    const next = new Set(visiting).add(definition.stableKey);
    return definition.condition.rules.every((rule) => {
      const parent = owners.get(rule.fieldKey);
      return !!parent && resolved(parent, next);
    });
  }
  return definitions.every((definition) => resolved(definition, new Set()));
}

export function applicableQuestion(
  definition: QuestionDefinition,
  answered: Map<string, AnswerApplicationQuestion["values"][number]["value"]>,
): boolean {
  if (definition.required === "optional") return false;
  if (definition.condition.state === "unknown") return true;
  if (definition.condition.state === "unconditional") return definition.visibility !== "hidden";
  for (const rule of definition.condition.rules) {
    const value = answered.get(rule.fieldKey);
    if (value === undefined) return true;
    const values = Array.isArray(value) ? value : [String(value)];
    const matches = values.some((entry) => rule.values.includes(entry));
    if (rule.operator === "not_equals" ? matches : !matches) return false;
  }
  return true;
}

export function assertObservationUrl(jobUrl: string, sourceUrl: string) {
  let expected: URL;
  let observed: URL;
  try {
    expected = new URL(jobUrl);
    observed = new URL(sourceUrl);
  } catch {
    throw badRequest("A valid owned job URL is required.");
  }
  const expectedPath = expected.pathname.replace(/\/$/, "");
  const observedPath = observed.pathname.replace(/\/$/, "");
  expected.searchParams.sort();
  observed.searchParams.sort();
  const suffix = expected.hostname === "jobs.ashbyhq.com" ? "/application" : "/apply";
  const hostedApply =
    ["jobs.lever.co", "jobs.eu.lever.co", "jobs.ashbyhq.com"].includes(expected.hostname) &&
    observedPath === `${expectedPath}${suffix}`;
  if (
    !["http:", "https:"].includes(observed.protocol) ||
    observed.username ||
    observed.password ||
    expected.username ||
    expected.password ||
    expected.origin !== observed.origin ||
    expected.search !== observed.search ||
    (expectedPath !== observedPath && !hostedApply)
  )
    throw badRequest("Form observations must belong to the exact owned job origin and path.");
}
