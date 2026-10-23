import { normalizePhone, optionalPhoneSchema } from "./phone";
import {
  jobPreferencesSchema,
  USER_DEFAULT_VALUES,
  userWithAutoApplySchema,
  workAuthorizationSchema,
} from "./user";
import { expect, test } from "bun:test";

test("international phone formatting is accepted and normalized without duplicating the prefix", () => {
  expect(optionalPhoneSchema.parse(" +1 (416) 555-2671 ")).toBe("+14165552671");
  expect(normalizePhone("(416) 555-2671", "CA")).toBe("+14165552671");
  expect(normalizePhone("+44 20 7946 0958", "CA")).toBe("+442079460958");
  expect(optionalPhoneSchema.parse("+114165552671")).toBe("+14165552671");
  expect(optionalPhoneSchema.safeParse("437").success).toBe(false);
});

test("unlimited and bounded campaign limits survive profile validation", () => {
  const profile = {
    ...USER_DEFAULT_VALUES,
    firstName: "Test",
    lastName: "Person",
    contactEmail: "test@example.com",
  };
  for (const limit of [null, 0, 1, 10, 500]) {
    const result = userWithAutoApplySchema.parse({
      ...profile,
      autoApply: { ...USER_DEFAULT_VALUES.autoApply, maxApplicationsPerCampaign: limit },
    });
    expect(result.autoApply?.maxApplicationsPerCampaign).toBe(limit === 0 ? null : limit);
  }
  for (const limit of [-1, 501, 1.5])
    expect(
      userWithAutoApplySchema.safeParse({
        ...profile,
        autoApply: { ...USER_DEFAULT_VALUES.autoApply, maxApplicationsPerCampaign: limit },
      }).success,
    ).toBe(false);
});

test("unanswered authorization is distinct from an explicit No", () => {
  const entries = [
    { country: "Canada", authorized: true, sponsorship: true },
    { country: "United States", authorized: null, sponsorship: null },
    { country: "United Kingdom", authorized: false, sponsorship: false },
  ];
  expect(workAuthorizationSchema.parse(entries)).toEqual(entries);
  expect(
    workAuthorizationSchema.safeParse([{ country: "Canada", authorized: "yes", sponsorship: null }])
      .success,
  ).toBe(false);
});

test("role preferences allow multiple selections or any role without inferred defaults", () => {
  const preferences = USER_DEFAULT_VALUES.jobPreferences!;
  expect(jobPreferencesSchema.parse(preferences).roles).toEqual([]);
  expect(
    jobPreferencesSchema.parse({ ...preferences, roles: ["Frontend", "Backend", "Full stack"] })
      .roles,
  ).toEqual(["Frontend", "Backend", "Full stack"]);
  expect(jobPreferencesSchema.safeParse({ ...preferences, roles: ["Unknown role"] }).success).toBe(
    false,
  );
  expect(jobPreferencesSchema.safeParse({ ...preferences, roles: undefined }).success).toBe(false);
});

test("optional application facts stay blank until supplied by the applicant", () => {
  const result = userWithAutoApplySchema.parse({
    ...USER_DEFAULT_VALUES,
    firstName: "Test",
    lastName: "Person",
    contactEmail: "test@example.com",
    preferredName: undefined,
    namePronunciation: null,
    pronouns: "",
    currentCompany: null,
    portfolio: undefined,
    additionalLinks: [],
  });
  expect(result.preferredName).toBeUndefined();
  expect(result.namePronunciation).toBeNull();
  expect(result.pronouns).toBe("");
  expect(result.currentCompany).toBeNull();
  expect(result.portfolio).toBeUndefined();
  expect(result.additionalLinks).toEqual([]);
  expect(result.workAuthorization).toEqual([]);
});

test("validates reusable applicant fields and public links without accepting employer-specific facts", () => {
  const profile = {
    ...USER_DEFAULT_VALUES,
    firstName: "Test",
    lastName: "Person",
    contactEmail: "test@example.com",
    preferredName: "  T  ",
    namePronunciation: "tee",
    pronouns: "they/them",
    currentCompany: "Example Inc.",
    portfolio: "https://example.com/portfolio",
    additionalLinks: ["https://example.com/project", "http://example.com/writing"],
    previouslyEmployedAtAffirm: false,
    howFirstHeard: "LinkedIn",
  };
  const result = userWithAutoApplySchema.parse(profile);
  expect(result.preferredName).toBe("T");
  expect(result.namePronunciation).toBe("tee");
  expect(result.pronouns).toBe("they/them");
  expect(result.currentCompany).toBe("Example Inc.");
  expect(result.additionalLinks).toEqual(profile.additionalLinks);
  expect(result).not.toHaveProperty("previouslyEmployedAtAffirm");
  expect(result).not.toHaveProperty("howFirstHeard");
  expect(
    userWithAutoApplySchema.safeParse({ ...profile, preferredName: "x".repeat(201) }).success,
  ).toBe(false);
  expect(
    userWithAutoApplySchema.safeParse({ ...profile, portfolio: "javascript:alert(1)" }).success,
  ).toBe(false);
  expect(
    userWithAutoApplySchema.safeParse({ ...profile, additionalLinks: ["file:///private"] }).success,
  ).toBe(false);
  expect(
    userWithAutoApplySchema.safeParse({
      ...profile,
      additionalLinks: Array(11).fill("https://example.com"),
    }).success,
  ).toBe(false);
});
