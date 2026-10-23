import type { QuestionDefinition } from "@openapply/contracts/application-question";
import { prepareApplicationAnswer, questionNeedsInspection } from "./application-answer";
import { describe, expect, test } from "bun:test";

function definition(
  fields: QuestionDefinition["fields"],
  patch: Partial<QuestionDefinition> = {},
): QuestionDefinition {
  return {
    stableKey: "test",
    prompt: "Synthetic question",
    required: "required",
    visibility: "visible",
    condition: { state: "unconditional", rules: [] },
    groupMode: "all",
    fields,
    ...patch,
  };
}

describe("confirmed application answer preparation", () => {
  test("allows a server-listed hidden child with a known condition without asserting form completeness", () => {
    const schema = definition([{ key: "details", type: "text", options: [] }], {
      visibility: "hidden",
      condition: {
        state: "known",
        rules: [{ fieldKey: "sponsorship", operator: "equals", values: ["yes"] }],
      },
    });
    expect(questionNeedsInspection(schema, true)).toBe(false);
    expect(
      prepareApplicationAnswer(schema, { details: "Confirmed synthetic detail" }, true),
    ).toEqual([{ fieldKey: "details", value: "Confirmed synthetic detail" }]);
    expect(() =>
      prepareApplicationAnswer(schema, { details: "Confirmed synthetic detail" }, false),
    ).toThrow("inspection");
    expect(() =>
      prepareApplicationAnswer(
        { ...schema, condition: { state: "unknown", rules: [] } },
        { details: "answer" },
        true,
      ),
    ).toThrow("inspection");
    expect(() =>
      prepareApplicationAnswer({ ...schema, visibility: "unknown" }, { details: "answer" }, true),
    ).toThrow("inspection");
    expect(schema.visibility).toBe("hidden");
  });
  test("never invents missing boolean answers and preserves false and zero", () => {
    const schema = definition([
      { key: "yes", type: "boolean", options: [] },
      { key: "count", type: "number", options: [] },
    ]);
    expect(() => prepareApplicationAnswer(schema, {})).toThrow("Answer");
    expect(prepareApplicationAnswer(schema, { yes: "false", count: "0" })).toEqual([
      { fieldKey: "count", value: 0 },
      { fieldKey: "yes", value: false },
    ]);
  });
  test("preserves exact option values and rejects invented free text", () => {
    const schema = definition([
      { key: "choice", type: "single_choice", options: [{ label: "Option", value: " exact " }] },
    ]);
    expect(prepareApplicationAnswer(schema, { choice: " exact " })).toEqual([
      { fieldKey: "choice", value: " exact " },
    ]);
    expect(() => prepareApplicationAnswer(schema, { choice: "other" })).toThrow("provided");
  });
  test("deduplicates and validates multiple choices", () => {
    const schema = definition([
      {
        key: "multi",
        type: "multi_choice",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      },
    ]);
    expect(prepareApplicationAnswer(schema, { multi: ["b", "a", "b"] })).toEqual([
      { fieldKey: "multi", value: ["a", "b"] },
    ]);
    expect(() => prepareApplicationAnswer(schema, { multi: ["c"] })).toThrow("provided");
  });
  test("allows a text alternative to a file without fabricating a file answer", () => {
    const fields: QuestionDefinition["fields"] = [
      { key: "file", type: "file", options: [] },
      { key: "text", type: "text", options: [] },
    ];
    expect(
      prepareApplicationAnswer(definition(fields, { groupMode: "any" }), {
        text: "User supplied text",
      }),
    ).toEqual([{ fieldKey: "text", value: "User supplied text" }]);
    expect(() =>
      prepareApplicationAnswer(definition(fields), { text: "User supplied text" }),
    ).toThrow("Answer");
    expect(() => prepareApplicationAnswer(definition(fields, { groupMode: "any" }), {})).toThrow(
      "alternative",
    );
  });
  test("blocks unknown conditions and unobserved visibility", () => {
    const fields: QuestionDefinition["fields"] = [{ key: "text", type: "text", options: [] }];
    expect(() =>
      prepareApplicationAnswer(definition(fields, { condition: { state: "unknown", rules: [] } }), {
        text: "answer",
      }),
    ).toThrow("inspection");
    expect(() =>
      prepareApplicationAnswer(definition(fields, { visibility: "hidden" }), { text: "answer" }),
    ).toThrow("inspection");
  });
  test("a separately selected PDF satisfies a grouped file without creating a filename answer", () => {
    const schema = definition([
      { key: "resume", type: "file", options: [] },
      { key: "explanation", type: "text", options: [] },
    ]);
    expect(
      prepareApplicationAnswer(schema, { explanation: "Confirmed detail" }, true, ["resume"]),
    ).toEqual([{ fieldKey: "explanation", value: "Confirmed detail" }]);
    expect(() =>
      prepareApplicationAnswer(
        schema,
        { resume: "resume.pdf", explanation: "Confirmed detail" },
        true,
        ["resume"],
      ),
    ).toThrow("cannot be confirmed as text");
    expect(() => prepareApplicationAnswer(schema, {}, true, ["resume"])).toThrow("Answer");
    expect(() =>
      prepareApplicationAnswer(schema, { explanation: "Confirmed detail" }, true, ["other"]),
    ).toThrow("Answer");
  });
  test("validates numeric and date values rather than coercing malformed text", () => {
    expect(() =>
      prepareApplicationAnswer(definition([{ key: "n", type: "number", options: [] }]), {
        n: "NaN",
      }),
    ).toThrow("number");
    expect(() =>
      prepareApplicationAnswer(definition([{ key: "d", type: "date", options: [] }]), {
        d: "2026-02-30",
      }),
    ).toThrow("date");
  });
});
