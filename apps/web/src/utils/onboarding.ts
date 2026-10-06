interface IdentityFields {
  firstName: string;
  lastName: string;
}

/** True when both names are blank on the /me object - i.e. the user hasn't onboarded yet. */
function isOnboardingIncomplete(user: IdentityFields): boolean {
  return user.firstName.trim() === "" && user.lastName.trim() === "";
}

export function onboardingRedirect(
  pathname: string,
  user: IdentityFields,
): "/onboarding" | "/mvp" | null {
  const onboarding = pathname === "/onboarding";
  if (isOnboardingIncomplete(user)) return onboarding ? null : "/onboarding";
  return onboarding ? "/mvp" : null;
}
