import type { ApplicationQuestionView } from "@openapply/contracts/application-question";
import { savedAnswerDraft } from "./saved-answer-draft";
import { expect, test } from "bun:test";

const question = {
  blocking: true,
  definition: {
    stableKey: "q",
    prompt: "Synthetic question",
    required: "required",
    visibility: "visible",
    condition: { state: "unconditional", rules: [] },
    groupMode: "all",
    fields: [
      { key: "flag", type: "boolean", options: [] },
      { key: "number", type: "number", options: [] },
    ],
  },
} satisfies Pick<ApplicationQuestionView, "definition" | "blocking">;

test("saved answer mapping preserves explicit false and zero without confirming the form", () => {
  expect(
    savedAnswerDraft(question, [
      { fieldKey: "flag", value: false },
      { fieldKey: "number", value: 0 },
    ]),
  ).toEqual({ flag: "false", number: "0" });
});

test("saved answers cannot supply a different field, repeated field or coerced type", () => {
  expect(() => savedAnswerDraft(question, [{ fieldKey: "foreign", value: "x" }])).toThrow(
    "exact question",
  );
  expect(() =>
    savedAnswerDraft(question, [
      { fieldKey: "flag", value: false },
      { fieldKey: "flag", value: true },
    ]),
  ).toThrow("exact question");
  expect(() =>
    savedAnswerDraft(question, [
      { fieldKey: "flag", value: "false" },
      { fieldKey: "number", value: 0 },
    ]),
  ).toThrow("field type");
});
