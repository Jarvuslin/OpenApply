import type {
  BankQuestionContext,
  BankSourceCandidate,
  BankTargetQuestion,
  QuestionCategory,
} from "@openapply/contracts/answer-bank";
import type { QuestionDefinition } from "@openapply/contracts/application-question";
import { mapBankAnswer } from "./answer-bank.policy";
import { expect } from "bun:test";
export const context: BankQuestionContext = {
  countryCode: "CA",
  countryConfirmed: true,
  company: "Acme Labs",
  jobTitle: "Software Engineer",
};
export function definition(): QuestionDefinition {
  return {
    stableKey: "fields:old",
    prompt: "Are you legally authorized to work in Canada?",
    required: "required",
    visibility: "visible",
    condition: { state: "unconditional", rules: [] },
    groupMode: "all",
    fields: [
      {
        key: "old",
        type: "single_choice",
        options: [
          { value: "SOURCE_Y", label: "Yes" },
          { value: "SOURCE_N", label: "No" },
        ],
      },
    ],
  };
}
export function source(category: QuestionCategory = "authorization"): BankSourceCandidate {
  return {
    definition: definition(),
    category,
    values: [{ fieldKey: "old", value: "SOURCE_Y" }],
    countryCode: "CA",
    employerKey: null,
    roleKey: null,
  };
}
export function target(candidate: BankSourceCandidate): BankTargetQuestion {
  return {
    ...context,
    category: candidate.category,
    definition: structuredClone(candidate.definition),
  };
}
export function rejected(
  candidate: BankSourceCandidate,
  destination: BankTargetQuestion,
  reason?: RegExp,
) {
  const result = mapBankAnswer(candidate, destination);
  expect(result.matched).toBe(false);
  expect(result.values).toBeNull();
  if (reason) expect(result.reason).toMatch(reason);
}
