import { USER_DEFAULT_VALUES } from "@openapply/contracts/user";
import { migrateOnboardingDraft, readOnboardingDraft } from "./onboarding-draft";
import { expect, test } from "bun:test";

function storedDraft(value: unknown) {
  let raw = JSON.stringify(value);
  let writes = 0;
  return {
    getItem: () => raw,
    setItem: (_key: string, next: string) => {
      raw = next;
      writes++;
    },
    writes: () => writes,
  };
}

test("migrations persist once and strict reads do not adapt old formats", () => {
  const disk = storedDraft({ version: 3, userId: "a", step: 2, values: USER_DEFAULT_VALUES });
  expect(() => readOnboardingDraft(disk, "a")).toThrow();
  migrateOnboardingDraft(disk, "a");
  expect(readOnboardingDraft(disk, "a")?.version).toBe(4);
  expect(readOnboardingDraft(disk, "a")?.step).toBe(1);
  migrateOnboardingDraft(disk, "a");
  expect(disk.writes()).toBe(1);
});

test("each previous step maps to its matching Resume-first step", () => {
  for (const version of [1, 2, 3]) {
    const expected = version === 1 ? [0, 1, 2, 3, 4, 4] : [0, 0, 1, 2, 3, 4];
    for (let step = 0; step < 6; step++) {
      const disk = storedDraft({ version, userId: "a", step, values: USER_DEFAULT_VALUES });
      migrateOnboardingDraft(disk, "a");
      expect(readOnboardingDraft(disk, "a")?.step).toBe(expected[step]);
    }
  }
});

test("migration preserves unfinished fields, resume selection and confirmed eligibility", () => {
  const values = {
    ...USER_DEFAULT_VALUES,
    firstName: "Saved name",
    contactEmail: "unfinished@",
    phone: "437",
    references: [{ name: "", email: "partial" }],
    primaryResumeId: "b6e89fba-3bf7-4bb3-8087-2611f466b182",
    jobPreferences: {
      levels: ["Entry" as const],
      yearsExperience: null,
      workModes: ["Hybrid" as const],
      employmentTypes: ["Full-time" as const],
    },
    preferredLocations: ["Toronto, Canada"],
    workAuthorization: [{ country: "Canada", authorized: true, sponsorship: true }],
    autoApply: { ...USER_DEFAULT_VALUES.autoApply, minMatchScore: null },
  };
  const disk = storedDraft({ version: 2, userId: "a", step: 4, values });
  migrateOnboardingDraft(disk, "a");
  expect<unknown>(readOnboardingDraft(disk, "a")?.values).toEqual({
    ...values,
    jobPreferences: { ...values.jobPreferences, roles: [] },
  });
});

test("version 3 migration preserves chosen role families", () => {
  const values = {
    ...USER_DEFAULT_VALUES,
    jobPreferences: { ...USER_DEFAULT_VALUES.jobPreferences, roles: ["Frontend"] },
  };
  const disk = storedDraft({ version: 3, userId: "a", step: 4, values });
  migrateOnboardingDraft(disk, "a");
  expect(readOnboardingDraft(disk, "a")?.values.jobPreferences?.roles).toEqual(["Frontend"]);
});

test("invalid, wrong-owner and unsupported drafts are preserved without writes", () => {
  const invalid = [
    { version: 3, userId: "other", step: 1, values: USER_DEFAULT_VALUES },
    { version: 3, userId: "a", step: 99, values: USER_DEFAULT_VALUES },
    { version: 99, userId: "a", step: 1, values: USER_DEFAULT_VALUES },
    { version: 3, userId: "a", step: 1, values: { ...USER_DEFAULT_VALUES, firstName: 9 } },
  ];
  for (const value of invalid) {
    const disk = storedDraft(value);
    const original = disk.getItem();
    expect(() => migrateOnboardingDraft(disk, "a")).toThrow();
    expect(disk.getItem()).toBe(original);
    expect(disk.writes()).toBe(0);
  }
});
