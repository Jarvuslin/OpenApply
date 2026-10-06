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
    jobPreferences: values.jobPreferences ?? structuredClone(USER_DEFAULT_VALUES.jobPreferences),
    workAuthorization: values.workAuthorization ?? [],
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
