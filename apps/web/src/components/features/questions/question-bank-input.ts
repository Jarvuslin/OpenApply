import {
  BANK_COUNTRY_REQUIRED_CATEGORIES,
  type SaveToProfile,
  type UseSavedAnswer,
} from "@openapply/contracts/answer-bank-input";
import type { ApplicationQuestionView } from "@openapply/contracts/application-question";

export function needsAnswerCountry(category: ApplicationQuestionView["category"]): boolean {
  return BANK_COUNTRY_REQUIRED_CATEGORIES.some((value) => value === category);
}

export function questionBankInput(
  question: Pick<ApplicationQuestionView, "category">,
  settings: {
    save: boolean;
    scope: SaveToProfile["scope"];
    countryCode: string;
    countryConfirmed: boolean;
  },
  selected: UseSavedAnswer | null,
) {
  const countryRequired = needsAnswerCountry(question.category);
  if (
    (settings.save || selected) &&
    countryRequired &&
    (!settings.countryConfirmed || !/^[A-Z]{2}$/.test(settings.countryCode))
  )
    throw new Error("Choose and confirm the country before saving or reusing this answer.");
  if (settings.save && question.category === "other" && settings.scope !== "employer")
    throw new Error("Save this answer only for the same employer and role.");
  const country = countryRequired
    ? { countryCode: settings.countryCode, countryConfirmed: true as const }
    : {};
  return {
    ...(settings.save && {
      saveToProfile: { consent: true as const, scope: settings.scope, ...country },
    }),
    ...(selected && {
      useSavedAnswer: { entryId: selected.entryId, revision: selected.revision, ...country },
    }),
  };
}
