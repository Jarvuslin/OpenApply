import { env } from "@/env";

export function canUseCaptchaSolver(_user: { id: string }): boolean {
  // Add the user's paid-plan check here when billing is introduced.
  return env.CAPTCHA_SOLVER_ENABLED;
}
