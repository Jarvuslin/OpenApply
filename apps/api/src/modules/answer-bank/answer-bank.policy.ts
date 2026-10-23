import type {
  BankQuestionContext,
  BankScope,
  BankSourceCandidate,
  BankTargetQuestion,
  QuestionAnswerValues,
  QuestionCategory,
} from "@openapply/contracts/answer-bank";
import { BANK_COUNTRY_REQUIRED_CATEGORIES } from "@openapply/contracts/answer-bank-input";
import type { QuestionDefinition } from "@openapply/contracts/application-question";
import { sha256 } from "@/common/crypto/hash";
import { validateAnswer } from "../application-question/question.policy";

export const BANK_NORMALIZER_VERSION = "exact-v1";

const countries = new Set(
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(
    " ",
  ),
);
const countryRequired = new Set<QuestionCategory>(BANK_COUNTRY_REQUIRED_CATEGORIES);
const authentication =
  /password|passphrase|\b(?:otp|2fa|mfa)\b|one[\s-]?time.*(?:code|password)|(?:verification|security|authentication|access)[\s_-]*code/i;
type Field = QuestionDefinition["fields"][number];
type Eligibility = {
  eligible: boolean;
  reason: string | null;
  fingerprint: string | null;
  employerKey: string | null;
  roleKey: string | null;
};
type Match = { matched: boolean; reason: string | null; values: QuestionAnswerValues | null };

export function normalizeBankText(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ");
}

function countryKey(value: string | null): string | null | undefined {
  if (value === null) return null;
  const code = value.trim().toUpperCase();
  return countries.has(code) ? code : undefined;
}

function fieldLabel(definition: QuestionDefinition, field: Field): string {
  const label = normalizeBankText(field.label ?? "");
  if (label) return label;
  return definition.fields.length === 1 ? normalizeBankText(definition.prompt) : "";
}

function unavailable(reason: string): Eligibility {
  return { eligible: false, reason, fingerprint: null, employerKey: null, roleKey: null };
}

function noMatch(reason: string): Match {
  return { matched: false, reason, values: null };
}

function compareLabels(first: { label: string }, second: { label: string }): number {
  if (first.label < second.label) return -1;
  if (first.label > second.label) return 1;
  return 0;
}

function definitionProblem(definition: QuestionDefinition): string | null {
  if (!normalizeBankText(definition.prompt)) return "The question has no explicit prompt.";
  if (
    definition.required === "unknown" ||
    definition.visibility !== "visible" ||
    definition.condition.state !== "unconditional" ||
    definition.condition.rules.length
  )
    return "Unknown or conditional question context cannot be reused.";
  if (
    !definition.fields.length ||
    definition.fields.some((field) => ["file", "unknown"].includes(field.type))
  )
    return "Files and unknown controls cannot use saved text answers.";
  if (
    authentication.test(
      [
        definition.prompt,
        definition.description,
        ...definition.fields.flatMap((field) => [
          field.key.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2"),
          field.label,
        ]),
      ]
        .filter(Boolean)
        .join(" "),
    )
  )
    return "Passwords and authentication codes cannot be saved for reuse.";
  const labels = new Set<string>();
  const keys = new Set<string>();
  for (const field of definition.fields) {
    const label = fieldLabel(definition, field);
    if (!label || labels.has(label) || !field.key || keys.has(field.key))
      return "Field labels are missing or ambiguous; fields cannot be mapped safely.";
    labels.add(label);
    keys.add(field.key);
    const choice = ["single_choice", "multi_choice"].includes(field.type);
    if (choice !== field.options.length > 0)
      return "Control type and options do not describe an unambiguous answer.";
    const optionLabels = new Set<string>();
    const optionValues = new Set<string>();
    for (const option of field.options) {
      const optionLabel = normalizeBankText(option.label);
      if (
        !optionLabel ||
        optionLabels.has(optionLabel) ||
        !option.value ||
        optionValues.has(option.value)
      )
        return "Option labels or identifiers are missing or ambiguous.";
      if (option.freeText && option.freeText !== "none")
        return "Options with unresolved free-text requirements cannot be reused.";
      optionLabels.add(optionLabel);
      optionValues.add(option.value);
    }
  }
  return null;
}

export function bankEligibility(
  definition: QuestionDefinition,
  category: QuestionCategory,
  context: BankQuestionContext,
  scope: BankScope,
): Eligibility {
  const problem = definitionProblem(definition);
  if (problem) return unavailable(problem);
  if (category === "document")
    return unavailable("Document answers cannot be reused as saved text.");
  const country = countryKey(context.countryCode);
  if (
    country === undefined ||
    (country !== null && !context.countryConfirmed) ||
    (countryRequired.has(category) && (!country || !context.countryConfirmed))
  )
    return unavailable("An explicitly confirmed ISO country is required for this answer context.");
  const company = normalizeBankText(context.company ?? "");
  const role = normalizeBankText(context.jobTitle ?? "");
  if (scope === "employer" && !company)
    return unavailable("Employer-scoped answers require a known employer.");
  if (category === "other" && (scope !== "employer" || !company || !role))
    return unavailable("Other and prose answers require the same known employer and role.");
  const fields = definition.fields
    .map((field) => ({
      label: fieldLabel(definition, field),
      type: field.type,
      options: field.options
        .map((option) => ({
          label: normalizeBankText(option.label),
          freeText: option.freeText ?? "none",
        }))
        .sort(compareLabels),
    }))
    .sort(compareLabels);
  const semantic = {
    version: BANK_NORMALIZER_VERSION,
    category,
    prompt: normalizeBankText(definition.prompt),
    description: normalizeBankText(definition.description ?? ""),
    required: definition.required,
    groupMode: definition.groupMode,
    fields,
  };
  return {
    eligible: true,
    reason: null,
    fingerprint: sha256(JSON.stringify(semantic)),
    employerKey: scope === "employer" ? company : null,
    roleKey: category === "other" ? role : null,
  };
}

function validValues(definition: QuestionDefinition, values: QuestionAnswerValues): boolean {
  if (
    !values.length ||
    values.some((entry) => typeof entry.value === "number" && !Number.isFinite(entry.value))
  )
    return false;
  try {
    validateAnswer(definition, values);
    return true;
  } catch {
    return false;
  }
}

export function mapBankAnswer(source: BankSourceCandidate, target: BankTargetQuestion): Match {
  if (source.category !== target.category) return noMatch("The question category differs.");
  const scope = source.employerKey === null ? "account" : "employer";
  const sourceEligibility = bankEligibility(
    source.definition,
    source.category,
    {
      countryCode: source.countryCode,
      countryConfirmed: source.countryCode !== null,
      company: source.employerKey,
      jobTitle: source.roleKey,
    },
    scope,
  );
  if (!sourceEligibility.eligible)
    return noMatch(sourceEligibility.reason ?? "The source answer is not eligible.");
  const targetEligibility = bankEligibility(target.definition, target.category, target, scope);
  if (!targetEligibility.eligible)
    return noMatch(targetEligibility.reason ?? "The target question is not eligible.");
  if (
    source.countryCode !== null &&
    (!target.countryConfirmed || countryKey(source.countryCode) !== countryKey(target.countryCode))
  )
    return noMatch("The explicitly confirmed country differs or is missing.");
  if (sourceEligibility.employerKey !== targetEligibility.employerKey)
    return noMatch("The saved answer belongs to a different employer.");
  if (sourceEligibility.roleKey !== targetEligibility.roleKey)
    return noMatch("The saved answer belongs to a different role.");
  if (sourceEligibility.fingerprint !== targetEligibility.fingerprint)
    return noMatch(
      "The prompt, help, field types, groups or option labels are not an exact normalized match.",
    );
  if (!validValues(source.definition, source.values))
    return noMatch("The source answer no longer matches its exact field and option identifiers.");
  const mapped: QuestionAnswerValues = [];
  for (const targetField of target.definition.fields) {
    const label = fieldLabel(target.definition, targetField);
    const sourceField = source.definition.fields.find(
      (field) => fieldLabel(source.definition, field) === label,
    );
    if (!sourceField) return noMatch("Fields could not be mapped by unique labels.");
    const entry = source.values.find((value) => value.fieldKey === sourceField.key);
    if (!entry) continue;
    if (["single_choice", "multi_choice"].includes(sourceField.type)) {
      const selected = Array.isArray(entry.value) ? entry.value : [entry.value];
      const values: string[] = [];
      for (const selectedValue of selected) {
        const option = sourceField.options.find((candidate) => candidate.value === selectedValue);
        const destination =
          option &&
          targetField.options.find(
            (candidate) => normalizeBankText(candidate.label) === normalizeBankText(option.label),
          );
        if (!destination)
          return noMatch("The selected option could not be mapped by an exact unique label.");
        values.push(destination.value);
      }
      mapped.push({
        fieldKey: targetField.key,
        value: sourceField.type === "multi_choice" ? values : values[0],
      });
    } else mapped.push({ fieldKey: targetField.key, value: entry.value });
  }
  if (!validValues(target.definition, mapped))
    return noMatch("The mapped answer does not satisfy the target field types and groups.");
  return { matched: true, reason: null, values: mapped };
}
