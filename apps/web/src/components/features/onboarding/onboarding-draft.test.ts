import { USER_DEFAULT_VALUES, userWithAutoApplySchema } from "@openapply/contracts/user";
import { readOnboardingDraft, writeOnboardingDraft } from "./onboarding-draft";
import { expect, test } from "bun:test";

function storage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

test("invalid partial answers and nested entries survive a reload at the current step", () => {
  const disk = storage();
  const values = {
    ...USER_DEFAULT_VALUES,
    firstName: "Y",
    contactEmail: "unfinished@",
    phone: "437",
    references: [{ name: "", email: "partial" }],
  };
  expect(userWithAutoApplySchema.safeParse(values).success).toBe(false);
  writeOnboardingDraft(disk, "a", values, 3);
  const reloaded = readOnboardingDraft(disk, "a");
  expect(reloaded?.values).toEqual(values);
  expect(reloaded?.step).toBe(3);
});

test("drafts belong to a single account", () => {
  const disk = storage();
  writeOnboardingDraft(disk, "a", USER_DEFAULT_VALUES, 2);
  expect(readOnboardingDraft(disk, "b")).toBeNull();
  writeOnboardingDraft(disk, "b", { ...USER_DEFAULT_VALUES, firstName: "B" }, 1);
  expect(readOnboardingDraft(disk, "a")?.step).toBe(2);
});

test("clearing a required numeric field does not discard the rest of the draft", () => {
  const raw = JSON.stringify({
    version: 1,
    userId: "a",
    step: 3,
    values: {
      ...USER_DEFAULT_VALUES,
      firstName: "Saved name",
      autoApply: { ...USER_DEFAULT_VALUES.autoApply, minMatchScore: null },
    },
  });
  const draft = readOnboardingDraft({ getItem: () => raw }, "a");
  expect(draft?.values.firstName).toBe("Saved name");
  expect(draft?.values.autoApply?.minMatchScore).toBeNull();
  expect(userWithAutoApplySchema.safeParse(draft?.values).success).toBe(false);
});

test("continuing to agent setup keeps unfinished values", () => {
  const disk = storage();
  writeOnboardingDraft(disk, "a", USER_DEFAULT_VALUES, 5);
  expect(readOnboardingDraft(disk, "a")?.step).toBe(5);
  expect(readOnboardingDraft(disk, "a")?.values.firstName).toBe("");
});

test("malformed drafts report failure rather than silently resetting", () => {
  expect(() => readOnboardingDraft({ getItem: () => "{" }, "a")).toThrow();
  expect(() =>
    readOnboardingDraft(
      {
        getItem: () =>
          JSON.stringify({ version: 1, userId: "a", step: 99, values: USER_DEFAULT_VALUES }),
      },
      "a",
    ),
  ).toThrow();
});

test("wrong-owner payload and unavailable storage report failure", () => {
  expect(() =>
    readOnboardingDraft(
      {
        getItem: () =>
          JSON.stringify({ version: 1, userId: "other", step: 1, values: USER_DEFAULT_VALUES }),
      },
      "a",
    ),
  ).toThrow();
  expect(() =>
    writeOnboardingDraft(
      {
        setItem: () => {
          throw new Error("quota");
        },
      },
      "a",
      USER_DEFAULT_VALUES,
      1,
    ),
  ).toThrow("quota");
});
