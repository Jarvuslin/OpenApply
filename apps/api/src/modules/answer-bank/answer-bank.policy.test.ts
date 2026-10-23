import {
  BANK_NORMALIZER_VERSION,
  bankEligibility,
  mapBankAnswer,
  normalizeBankText,
} from "./answer-bank.policy";
import { context, definition, rejected, source, target } from "./policy-fakes";
import { describe, expect, it } from "bun:test";

describe("conservative normalized answer identity", () => {
  it("normalizes only NFC and whitespace, preserving case, punctuation, units and negation", () => {
    expect(normalizeBankText(" \tCafe\u0301  — NO.\n")).toBe("Café — NO.");
    for (const [first, second] of [
      ["US", "us"],
      ["mA", "MA"],
      ["No", "No!"],
      ["µg", "μg"],
      ["authorized", "not authorized"],
    ])
      expect(normalizeBankText(first)).not.toBe(normalizeBankText(second));
    expect(BANK_NORMALIZER_VERSION).toBe("exact-v1");
  });
  it("matches NFC and whitespace variations while ignoring provider field IDs and option ordering", () => {
    const candidate = source();
    candidate.definition.prompt = "Café authorization?";
    const destination = target(candidate);
    destination.definition.prompt = "  Cafe\u0301\n authorization?  ";
    destination.definition.stableKey = "provider:new";
    destination.definition.fields = [
      {
        key: "new",
        type: "single_choice",
        options: [
          { value: "0", label: " No " },
          { value: "1", label: "\tYes\n" },
        ],
      },
    ];
    expect(mapBankAnswer(candidate, destination)).toEqual({
      matched: true,
      reason: null,
      values: [{ fieldKey: "new", value: "1" }],
    });
    expect(
      bankEligibility(candidate.definition, candidate.category, context, "account").fingerprint,
    ).toBe(
      bankEligibility(destination.definition, destination.category, context, "account").fingerprint,
    );
  });
  for (const [name, prompt] of [
    ["negation", "Are you NOT legally authorized to work in Canada?"],
    ["timing", "Will you be legally authorized to work in Canada in the future?"],
    ["country wording", "Are you legally authorized to work in the United States?"],
    ["punctuation", "Are you legally authorized to work in Canada!"],
    ["case", "are you legally authorized to work in canada?"],
  ])
    it(`preserves ${name}`, () => {
      const candidate = source();
      const destination = target(candidate);
      destination.definition.prompt = prompt;
      rejected(candidate, destination, /exact normalized/);
    });
  it("separates authorization, sponsorship, opposite sponsorship and helper instructions", () => {
    const candidate = source();
    rejected(candidate, { ...target(candidate), category: "sponsorship" }, /category/);
    candidate.category = "sponsorship";
    candidate.definition.prompt = "Will you require sponsorship now or in the future?";
    const destination = target(candidate);
    destination.definition.prompt =
      "Can you confirm you do NOT require sponsorship now or in the future?";
    rejected(candidate, destination);
    destination.definition = structuredClone(candidate.definition);
    destination.definition.description = "Answer only for the current year.";
    rejected(candidate, destination, /exact normalized/);
  });
  it("preserves units and field types rather than coercing numbers or strings", () => {
    const candidate = source("contact");
    candidate.definition.prompt = "Current measure (mA)";
    candidate.definition.fields = [{ key: "old", type: "number", options: [] }];
    candidate.values = [{ fieldKey: "old", value: 10 }];
    const destination = target(candidate);
    destination.definition.prompt = "Current measure (MA)";
    rejected(candidate, destination);
    destination.definition = structuredClone(candidate.definition);
    destination.definition.fields[0].type = "text";
    rejected(candidate, destination);
    candidate.values[0].value = "10";
    rejected(candidate, target(candidate), /identifiers/);
  });
});

describe("bijective field and option mapping", () => {
  it("maps exact option labels, never yes/no guesses or option ID case folding", () => {
    const candidate = source();
    const destination = target(candidate);
    destination.definition.fields[0].options = [
      { value: "SOURCE_N", label: "Yes" },
      { value: "SOURCE_Y", label: "No" },
    ];
    expect(mapBankAnswer(candidate, destination).values).toEqual([
      { fieldKey: "old", value: "SOURCE_N" },
    ]);
    candidate.values[0].value = "source_y";
    rejected(candidate, destination, /identifiers/);
  });
  it("rejects changed option labels even when their provider identifiers stay the same", () => {
    const candidate = source();
    const destination = target(candidate);
    destination.definition.fields[0].options[1].label = "Not currently";
    rejected(candidate, destination, /exact normalized/);
  });
  it("rejects duplicate normalized option labels or duplicate option IDs", () => {
    for (const options of [
      [
        { value: "a", label: "Yes" },
        { value: "b", label: " Yes\n" },
      ],
      [
        { value: "a", label: "Yes" },
        { value: "a", label: "No" },
      ],
    ]) {
      const candidate = source();
      const destination = target(candidate);
      destination.definition.fields[0].options = options;
      rejected(candidate, destination, /ambiguous/);
    }
  });
  it("retains exact selected identifiers, including whitespace, across multichoice mapping", () => {
    const candidate = source();
    candidate.definition.fields[0].type = "multi_choice";
    candidate.values[0].value = ["SOURCE_N", "SOURCE_Y"];
    const destination = target(candidate);
    destination.definition.fields[0].options = [
      { value: " Yes ID ", label: "Yes" },
      { value: " no ID ", label: "No" },
    ];
    expect(mapBankAnswer(candidate, destination).values).toEqual([
      { fieldKey: "old", value: [" no ID ", " Yes ID "] },
    ]);
    candidate.values[0].value = ["SOURCE_Y", "SOURCE_Y"];
    rejected(candidate, destination, /identifiers/);
  });
  it("maps reversed multi-field layouts through unique labels without relying on indexes", () => {
    const candidate = source("contact");
    candidate.definition = {
      ...definition(),
      prompt: "Full name",
      fields: [
        { key: "first", label: "First name", type: "text", options: [] },
        { key: "last", label: "Last name", type: "text", options: [] },
      ],
    };
    candidate.values = [
      { fieldKey: "first", value: " Morgan " },
      { fieldKey: "last", value: "Fixture" },
    ];
    const destination = target(candidate);
    destination.definition.fields = [
      { key: "b", label: "Last name", type: "text", options: [] },
      { key: "a", label: "First name", type: "text", options: [] },
    ];
    expect(mapBankAnswer(candidate, destination).values).toEqual([
      { fieldKey: "b", value: "Fixture" },
      { fieldKey: "a", value: " Morgan " },
    ]);
    destination.definition.fields[0].label = "First name";
    rejected(candidate, destination, /ambiguous/);
    destination.definition.fields.forEach((field) => {
      field.label = undefined;
    });
    rejected(candidate, destination, /missing or ambiguous/);
  });
  it("preserves group requirements and rejects incomplete all-groups", () => {
    const candidate = source();
    const destination = target(candidate);
    destination.definition.groupMode = "any";
    rejected(candidate, destination);
    candidate.values = [];
    rejected(candidate, target(candidate), /identifiers/);
  });
  it("does not coerce yes/no strings into boolean answers", () => {
    const candidate = source("contact");
    candidate.definition.fields = [{ key: "old", type: "boolean", options: [] }];
    candidate.values = [{ fieldKey: "old", value: true }];
    expect(mapBankAnswer(candidate, target(candidate)).values).toEqual(candidate.values);
    candidate.values[0].value = "yes";
    rejected(candidate, target(candidate));
  });
});
