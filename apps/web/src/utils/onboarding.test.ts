import { onboardingRedirect } from "./onboarding";
import { describe, expect, test } from "bun:test";

describe("onboarding navigation", () => {
  const saved = { firstName: "Jane", lastName: "Doe" };
  const unfinished = { firstName: " ", lastName: "" };

  test("a saved profile returning to onboarding goes directly to the dashboard", () => {
    expect(onboardingRedirect("/onboarding", saved)).toBe("/mvp");
  });
  test("an unfinished profile stays in onboarding without a redirect loop", () => {
    expect(onboardingRedirect("/onboarding", unfinished)).toBeNull();
    expect(onboardingRedirect("/documents/resumes", unfinished)).toBe("/onboarding");
  });
  test("a saved profile can navigate normally", () => {
    expect(onboardingRedirect("/documents/resumes", saved)).toBeNull();
    expect(onboardingRedirect("/mvp", saved)).toBeNull();
  });
});
