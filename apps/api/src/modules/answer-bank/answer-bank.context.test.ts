import { BANK_COUNTRY_REQUIRED_CATEGORIES } from "@openapply/contracts/answer-bank-input";
import type { QuestionDefinition } from "@openapply/contracts/application-question";
import { questionCategory } from "../application-question/question.policy";
import { bankEligibility, mapBankAnswer } from "./answer-bank.policy";
import { context, definition, rejected, source, target } from "./policy-fakes";
import { describe, expect, it } from "bun:test";

describe("confirmed country and employer context", () => {
  for (const category of BANK_COUNTRY_REQUIRED_CATEGORIES)
    it(`requires an explicit valid country for ${category}`, () => {
      const candidate = source(category);
      if (category === "other") {
        candidate.employerKey = context.company;
        candidate.roleKey = context.jobTitle;
      }
      for (const change of [
        { countryCode: null },
        { countryConfirmed: false },
        { countryCode: "US" },
        { countryCode: "ZZ" },
        { countryCode: "XX" },
        { countryCode: "UK" },
      ])
        rejected(candidate, { ...target(candidate), ...change }, /country/);
      candidate.countryCode = null;
      rejected(candidate, target(candidate), /country/);
    });
  it("country code casing is normalized without changing question or option casing", () => {
    const candidate = source();
    candidate.countryCode = "ca";
    expect(mapBankAnswer(candidate, target(candidate)).matched).toBe(true);
  });
  it("supports account contact scope but enforces an optional country restriction", () => {
    const candidate = source("contact");
    candidate.countryCode = null;
    expect(
      mapBankAnswer(candidate, {
        ...target(candidate),
        countryCode: null,
        countryConfirmed: false,
        company: "Another employer",
      }).matched,
    ).toBe(true);
    candidate.countryCode = "CA";
    rejected(candidate, { ...target(candidate), countryCode: "US" }, /country/);
  });
  it("never crosses employer scope even for an identical question", () => {
    const candidate = source();
    candidate.employerKey = "Acme Labs";
    rejected(candidate, { ...target(candidate), company: "Other Labs" }, /employer/);
    expect(
      mapBankAnswer(candidate, { ...target(candidate), company: "  Acme\tLabs " }).matched,
    ).toBe(true);
  });
  it("requires employer and role for other/prose answers and matches neither generically", () => {
    const candidate = source("other");
    expect(bankEligibility(candidate.definition, "other", context, "account").eligible).toBe(false);
    candidate.employerKey = "Acme Labs";
    candidate.roleKey = "Software Engineer";
    expect(mapBankAnswer(candidate, target(candidate)).matched).toBe(true);
    rejected(candidate, { ...target(candidate), company: "Other Labs" }, /employer/);
    rejected(candidate, { ...target(candidate), jobTitle: "Product Manager" }, /role/);
    rejected(candidate, { ...target(candidate), jobTitle: null }, /role/);
  });
  for (const prompt of [
    "Do you have the legal right to work in Canada?",
    "Do you need visa support?",
    "What is your sex?",
    "Do you identify as a person with a long-term health condition?",
  ])
    it(`requires country for unclassified sensitive wording: ${prompt}`, () => {
      const candidate = source("other");
      candidate.definition.prompt = prompt;
      candidate.employerKey = context.company;
      candidate.roleKey = context.jobTitle;
      candidate.countryCode = null;
      expect(questionCategory(candidate.definition)).toBe("other");
      expect(
        bankEligibility(
          candidate.definition,
          "other",
          { ...context, countryCode: null, countryConfirmed: false },
          "employer",
        ).eligible,
      ).toBe(false);
      rejected(
        candidate,
        { ...target(candidate), countryCode: null, countryConfirmed: false },
        /country/,
      );
      candidate.countryCode = "CA";
      rejected(
        candidate,
        { ...target(candidate), countryCode: null, countryConfirmed: false },
        /country/,
      );
      rejected(candidate, { ...target(candidate), countryCode: "US" }, /country/);
      expect(mapBankAnswer(candidate, target(candidate)).matched).toBe(true);
      rejected(candidate, { ...target(candidate), company: "Another employer" }, /employer/);
      rejected(candidate, { ...target(candidate), jobTitle: "Another role" }, /role/);
    });
  it("keeps semantic fingerprints independent of country/employer scope", () => {
    const value = definition();
    expect(bankEligibility(value, "authorization", context, "account").fingerprint).toBe(
      bankEligibility(value, "authorization", { ...context, countryCode: "US" }, "employer")
        .fingerprint,
    );
  });
});

describe("unknown context and prohibited answer types", () => {
  for (const change of [
    { visibility: "hidden" },
    { visibility: "unknown" },
    { required: "unknown" },
    { condition: { state: "unknown", rules: [] } },
    {
      condition: {
        state: "known",
        rules: [{ fieldKey: "parent", operator: "equals", values: ["yes"] }],
      },
    },
  ] as Partial<QuestionDefinition>[])
    it(`rejects ${JSON.stringify(change)}`, () => {
      const candidate = source();
      rejected(
        candidate,
        { ...target(candidate), definition: { ...definition(), ...change } },
        /Unknown or conditional/,
      );
    });
  it("rejects files, unknown controls and unresolved free-text option dependencies", () => {
    for (const type of ["file", "unknown"] as const) {
      const candidate = source();
      candidate.definition.fields[0].type = type;
      rejected(candidate, target(candidate), /unknown controls/);
    }
    const candidate = source();
    candidate.definition.fields[0].options[0].freeText = "optional";
    rejected(candidate, target(candidate), /free-text/);
  });
  it("rejects passwords and OTPs appearing in prompts, descriptions or field keys", () => {
    for (const location of ["prompt", "description", "field"] as const) {
      const candidate = source("contact");
      if (location === "field") candidate.definition.fields[0].key = "verification_code";
      else candidate.definition[location] = "Enter your one-time authentication code";
      rejected(candidate, target(candidate), /authentication codes/);
    }
    for (const key of ["otp_code", "userOtp", "account-password"]) {
      const candidate = source("contact");
      candidate.definition.fields[0].key = key;
      rejected(candidate, target(candidate), /authentication codes/);
    }
  });
});
