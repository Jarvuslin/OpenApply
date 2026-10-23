import { sameAnswerValues } from "./question.values";
import { describe, expect, it } from "bun:test";

describe("typed answer equality", () => {
  it("ignores JSONB property, field and multi-choice order without changing inputs", () => {
    const stored = [
      { value: ["z", "A"], fieldKey: "choices" },
      { value: "Exact answer", fieldKey: "prose" },
    ];
    const original = structuredClone(stored);
    expect(
      sameAnswerValues(stored, [
        { fieldKey: "prose", value: "Exact answer" },
        { fieldKey: "choices", value: ["A", "z"] },
      ]),
    ).toBe(true);
    expect(stored).toEqual(original);
  });
  it("preserves scalar types, negation and exact text/option identifiers", () => {
    for (const [left, right] of [
      [true, "true"],
      [1, "1"],
      ["yes", "no"],
      ["Yes", "yes"],
      ["yes ", "yes"],
      ["é", "e\u0301"],
      [["Yes"], ["yes"]],
      [["a"], "a"],
    ])
      expect(
        sameAnswerValues([{ fieldKey: "one", value: left }], [{ fieldKey: "one", value: right }]),
      ).toBe(false);
  });
  it("rejects invalid or ambiguous stored values even against themselves", () => {
    for (const value of [
      null,
      [],
      [{ fieldKey: "one", value: null }],
      [{ fieldKey: "one", value: Number.NaN }],
      [{ fieldKey: "one", value: ["a", "a"] }],
      [
        { fieldKey: "one", value: "a" },
        { fieldKey: "one", value: "a" },
      ],
    ])
      expect(sameAnswerValues(value, value)).toBe(false);
  });
});
