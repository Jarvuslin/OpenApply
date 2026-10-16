import { BANK_SENSITIVE_CATEGORIES } from "@openapply/contracts/answer-bank-input";
import { needsAnswerCountry, questionBankInput } from "./question-bank-input";
import { describe, expect, test } from "bun:test";

const settings = {
  save: false,
  scope: "employer" as const,
  countryCode: "",
  countryConfirmed: false,
};
const selected = { entryId: "entry", revision: 4 };

describe("explicit saved-answer consent and country context", () => {
  test("ordinary factual confirmation never implicitly saves or reuses a sensitive answer", () => {
    expect(questionBankInput({ category: "authorization" }, settings, null)).toEqual({});
  });
  test("all sensitive categories require confirmed country for both saving and reuse", () => {
    for (const category of BANK_SENSITIVE_CATEGORIES) {
      expect(needsAnswerCountry(category)).toBe(true);
      for (const context of [
        { countryCode: "", countryConfirmed: true },
        { countryCode: "CA", countryConfirmed: false },
      ]) {
        expect(() =>
          questionBankInput({ category }, { ...settings, ...context, save: true }, null),
        ).toThrow("Choose and confirm");
        expect(() =>
          questionBankInput({ category }, { ...settings, ...context }, selected),
        ).toThrow("Choose and confirm");
      }
    }
  });
  test("reuse carries the chosen exact revision and explicit target country", () => {
    expect(
      questionBankInput(
        { category: "sponsorship" },
        { ...settings, countryCode: "CA", countryConfirmed: true },
        selected,
      ),
    ).toEqual({ useSavedAnswer: { ...selected, countryCode: "CA", countryConfirmed: true } });
  });
  test("save uses explicit scope and leaves no reuse reference after draft edits", () => {
    expect(questionBankInput({ category: "contact" }, { ...settings, save: true }, null)).toEqual({
      saveToProfile: { consent: true, scope: "employer" },
    });
    expect(() =>
      questionBankInput(
        { category: "other" },
        { ...settings, save: true, scope: "account", countryCode: "CA", countryConfirmed: true },
        null,
      ),
    ).toThrow("same employer and role");
  });
  test("unclassified answers require country because classification may miss sensitive wording", () => {
    expect(needsAnswerCountry("other")).toBe(true);
    expect(needsAnswerCountry("contact")).toBe(false);
    expect(() =>
      questionBankInput({ category: "other" }, { ...settings, save: true }, null),
    ).toThrow("Choose and confirm");
    expect(() => questionBankInput({ category: "other" }, settings, selected)).toThrow(
      "Choose and confirm",
    );
    expect(
      questionBankInput(
        { category: "other" },
        { ...settings, save: true, countryCode: "CA", countryConfirmed: true },
        null,
      ),
    ).toEqual({
      saveToProfile: {
        consent: true,
        scope: "employer",
        countryCode: "CA",
        countryConfirmed: true,
      },
    });
  });
});
