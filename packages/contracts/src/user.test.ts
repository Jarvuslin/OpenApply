import { normalizePhone, optionalPhoneSchema } from "./phone";
import { USER_DEFAULT_VALUES, userWithAutoApplySchema, workAuthorizationSchema } from "./user";
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
  expect(
    workAuthorizationSchema.safeParse([{ country: "Canada", authorized: null, sponsorship: false }])
      .success,
  ).toBe(false);
  expect(
    workAuthorizationSchema.safeParse([
      { country: "Canada", authorized: false, sponsorship: false },
    ]).success,
  ).toBe(true);
});
