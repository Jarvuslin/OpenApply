import { questionDefinition } from "./fakes";
import {
  applicableQuestion,
  assertObservationUrl,
  questionCategory,
  resolvedConditions,
  validateAnswer,
} from "./question.policy";
import { describe, expect, it } from "bun:test";

describe("application question policies", () => {
  it("keeps authorization, sponsorship and sensitive categories separate", () => {
    const definition = questionDefinition();
    expect(questionCategory(definition)).toBe("authorization");
    for (const [prompt, category] of [
      ["Will you need sponsorship?", "sponsorship"],
      ["Disability status", "disability"],
      ["Veteran status", "veteran"],
      ["Are you eligible?", "other"],
    ] as const)
      expect(questionCategory({ ...definition, prompt })).toBe(category);
  });
  it("validates exact choices, independent booleans and grouped alternatives", () => {
    const definition = questionDefinition();
    expect(() =>
      validateAnswer(definition, [{ fieldKey: "authorization", value: "Yes" }]),
    ).toThrow();
    expect(() => validateAnswer(definition, [{ fieldKey: "other", value: "yes" }])).toThrow();
    expect(() =>
      validateAnswer(definition, [
        { fieldKey: "authorization", value: "yes" },
        { fieldKey: "authorization", value: "no" },
      ]),
    ).toThrow();
    const alternatives = {
      ...definition,
      groupMode: "any" as const,
      fields: [
        { key: "resume", type: "file" as const, options: [] },
        { key: "resume_text", type: "text" as const, options: [] },
      ],
    };
    expect(() =>
      validateAnswer(alternatives, [{ fieldKey: "resume_text", value: "Confirmed resume text" }]),
    ).not.toThrow();
    expect(() =>
      validateAnswer(alternatives, [{ fieldKey: "resume", value: "pretend.pdf" }]),
    ).toThrow();
    expect(() =>
      validateAnswer({ ...definition, fields: [{ key: "date", type: "date", options: [] }] }, [
        { fieldKey: "date", value: "2026-02-31" },
      ]),
    ).toThrow();
  });
  it("requires unresolved parents and reactivates conditional child questions", () => {
    const definition = {
      ...questionDefinition("details"),
      visibility: "hidden" as const,
      condition: {
        state: "known" as const,
        rules: [{ fieldKey: "sponsor", operator: "equals" as const, values: ["yes"] }],
      },
    };
    expect(applicableQuestion(definition, new Map())).toBe(true);
    expect(applicableQuestion(definition, new Map([["sponsor", "no"]]))).toBe(false);
    expect(applicableQuestion(definition, new Map([["sponsor", "yes"]]))).toBe(true);
    expect(
      applicableQuestion({ ...definition, condition: { state: "unknown", rules: [] } }, new Map()),
    ).toBe(true);
  });
  it("allows only the owned job and documented hosted application suffixes", () => {
    for (const [base, observed] of [
      ["https://jobs.lever.co/acme/id", "https://jobs.lever.co/acme/id/apply"],
      ["https://jobs.ashbyhq.com/acme/id", "https://jobs.ashbyhq.com/acme/id/application"],
    ])
      expect(() => assertObservationUrl(base, observed)).not.toThrow();
    for (const observed of [
      "https://jobs.lever.co/other/id",
      "https://evil.test/acme/id",
      "https://user:secret@jobs.lever.co/acme/id",
      "file:///acme/id",
    ])
      expect(() => assertObservationUrl("https://jobs.lever.co/acme/id", observed)).toThrow();
    expect(() =>
      assertObservationUrl(
        "https://employer.test/apply?job=1",
        "https://employer.test/apply?job=2",
      ),
    ).toThrow();
  });
  it("refuses missing and circular condition identities", () => {
    const parent = questionDefinition("parent");
    const child = {
      ...questionDefinition("child"),
      condition: {
        state: "known" as const,
        rules: [{ fieldKey: "parent", operator: "equals" as const, values: ["yes"] }],
      },
    };
    expect(resolvedConditions([parent, child])).toBe(true);
    expect(resolvedConditions([child])).toBe(false);
    parent.condition = {
      state: "known",
      rules: [{ fieldKey: "child", operator: "equals", values: ["yes"] }],
    };
    expect(resolvedConditions([parent, child])).toBe(false);
  });
});
