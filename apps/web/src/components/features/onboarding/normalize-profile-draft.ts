import { normalizePhone } from "@openapply/contracts/phone";
import { USER_DEFAULT_VALUES, type UserWithAutoApplyInput } from "@openapply/contracts/user";
import { getCountries } from "libphonenumber-js";

export function normalizeProfileDraft(values: UserWithAutoApplyInput): UserWithAutoApplyInput {
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const country = getCountries().find(
    (code) => code === values.country || names.of(code) === values.country,
  );
  return {
    ...values,
    preferredName: values.preferredName ?? "",
    namePronunciation: values.namePronunciation ?? "",
    pronouns: values.pronouns ?? "",
    currentCompany: values.currentCompany ?? "",
    portfolio: values.portfolio ?? "",
    additionalLinks: values.additionalLinks ?? [],
    jobPreferences: values.jobPreferences ?? structuredClone(USER_DEFAULT_VALUES.jobPreferences),
    workAuthorization: values.workAuthorization ?? [],
    applicationAnswers: values.applicationAnswers ?? {},
    educationHistory: values.educationHistory ?? [],
    workHistory: values.workHistory ?? [],
    phone: values.phone ? normalizePhone(values.phone, country) : values.phone,
    autoApply: values.autoApply
      ? {
          ...values.autoApply,
          maxApplicationsPerCampaign:
            values.autoApply.maxApplicationsPerCampaign === 0
              ? null
              : values.autoApply.maxApplicationsPerCampaign,
        }
      : undefined,
  };
}
