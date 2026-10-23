import { USER_DEFAULT_VALUES, userWithAutoApplySchema } from "@openapply/contracts/user";
import {
  clearOnboardingDraft,
  readOnboardingDraft,
  writeOnboardingDraft,
} from "./onboarding-draft";
import { expect, test } from "bun:test";

function storage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
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

test("completing onboarding clears only the saved account's draft", () => {
  const disk = storage();
  writeOnboardingDraft(disk, "a", USER_DEFAULT_VALUES, 4);
  writeOnboardingDraft(disk, "b", { ...USER_DEFAULT_VALUES, firstName: "B" }, 2);
  clearOnboardingDraft(disk, "a");
  expect(readOnboardingDraft(disk, "a")).toBeNull();
  expect(readOnboardingDraft(disk, "b")?.values.firstName).toBe("B");
  expect(readOnboardingDraft(disk, "b")?.step).toBe(2);
});

test("clearing a required numeric field does not discard the rest of the draft", () => {
  const raw = JSON.stringify({
    version: 4,
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

test("continuing to review keeps unfinished values", () => {
  const disk = storage();
  writeOnboardingDraft(disk, "a", USER_DEFAULT_VALUES, 4);
  expect(readOnboardingDraft(disk, "a")?.step).toBe(4);
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

test("unanswered country authorization survives a draft restore", () => {
  const disk = storage();
  writeOnboardingDraft(
    disk,
    "a",
    {
      ...USER_DEFAULT_VALUES,
      workAuthorization: [{ country: "Canada", authorized: null, sponsorship: null }],
    },
    3,
  );
  expect(readOnboardingDraft(disk, "a")?.values.workAuthorization?.[0]?.authorized).toBeNull();
});

test("invalid experience values remain editable after reload", () => {
  const disk = storage();
  writeOnboardingDraft(
    disk,
    "a",
    {
      ...USER_DEFAULT_VALUES,
      jobPreferences: {
        roles: [],
        levels: [],
        yearsExperience: -1,
        workModes: [],
        employmentTypes: [],
      },
    },
    4,
  );
  expect(readOnboardingDraft(disk, "a")?.values.jobPreferences?.yearsExperience).toBe(-1);
});

test("optional applicant facts and unfinished links survive draft restore without inferring eligibility", () => {
  const disk = storage();
  const values = {
    ...USER_DEFAULT_VALUES,
    preferredName: "T",
    namePronunciation: "tee",
    pronouns: "they/them",
    currentCompany: "",
    portfolio: "https://",
    additionalLinks: ["unfinished-link"],
    workAuthorization: [
      { country: "Canada", authorized: true, sponsorship: true },
      { country: "United States", authorized: null, sponsorship: null },
    ],
  };
  writeOnboardingDraft(disk, "a", values, 2);
  expect(readOnboardingDraft(disk, "a")?.values).toEqual(values);
});

test("old drafts gain only empty optional fields and preserve confirmed Canadian answers", () => {
  const values = {
    ...USER_DEFAULT_VALUES,
    preferredName: undefined,
    namePronunciation: undefined,
    pronouns: undefined,
    currentCompany: undefined,
    portfolio: undefined,
    additionalLinks: undefined,
    workAuthorization: [{ country: "Canada", authorized: true, sponsorship: true }],
  };
  const disk = storage();
  writeOnboardingDraft(disk, "a", values, 2);
  const result = readOnboardingDraft(disk, "a")?.values;
  expect(result?.preferredName).toBe("");
  expect(result?.namePronunciation).toBe("");
  expect(result?.pronouns).toBe("");
  expect(result?.currentCompany).toBe("");
  expect(result?.portfolio).toBe("");
  expect(result?.additionalLinks).toEqual([]);
  expect(result?.workAuthorization).toEqual(values.workAuthorization);
});

test("current drafts preserve selected role families and explicitly clearing them", () => {
  const disk = storage();
  writeOnboardingDraft(
    disk,
    "a",
    {
      ...USER_DEFAULT_VALUES,
      jobPreferences: { ...USER_DEFAULT_VALUES.jobPreferences!, roles: ["Frontend", "Full stack"] },
    },
    4,
  );
  const draft = readOnboardingDraft(disk, "a");
  expect(draft?.version).toBe(4);
  expect(draft?.values.jobPreferences?.roles).toEqual(["Frontend", "Full stack"]);
  writeOnboardingDraft(
    disk,
    "a",
    {
      ...draft!.values,
      jobPreferences: { ...draft!.values.jobPreferences!, roles: [] },
    },
    4,
  );
  expect(readOnboardingDraft(disk, "a")?.values.jobPreferences?.roles).toEqual([]);
});

test("a malformed current role selection fails restore instead of silently widening preferences", () => {
  const raw = JSON.stringify({
    version: 4,
    userId: "a",
    step: 4,
    values: {
      ...USER_DEFAULT_VALUES,
      jobPreferences: { ...USER_DEFAULT_VALUES.jobPreferences, roles: ["Unknown role"] },
    },
  });
  expect(() => readOnboardingDraft({ getItem: () => raw }, "a")).toThrow();
});
