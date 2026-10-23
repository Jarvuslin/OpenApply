import { Elysia } from "elysia";
import { type AuthUser, verifyAccessToken } from "@/common/auth";
import { container } from "@/common/di/container";
import { unauthorized } from "@/common/errors";
import { ApiTokenService } from "@/modules/auth/api-token.service";
import { type AuthContext, type AuthKind, resolveRequestAuth } from "./auth-resolution";

const apiTokenService = container.resolve(ApiTokenService);

function resolveAuth(context: AuthContext) {
  return resolveRequestAuth(context, {
    session: verifyAccessToken,
    agent: (token) => apiTokenService.verify(token),
  });
}

/**
 * Resolve the principal from a request: prefer `Authorization: Bearer` (web JWT
 * or the agent's PAT), then the httpOnly `accessToken` cookie. Returns null when
 * unauthenticated.
 */
export async function resolveAuthUser(context: AuthContext): Promise<AuthUser | null> {
  return (await resolveAuth(context))?.user ?? null;
}

/** Derives the unchanged principal plus server-authenticated request provenance. */
export const authGuard = new Elysia({ name: "auth-guard" }).derive(
  { as: "scoped" },
  async ({ headers, cookie }): Promise<{ user: AuthUser; authKind: AuthKind }> => {
    const auth = await resolveAuth({ headers, cookie });
    if (!auth) {
      throw unauthorized("Missing authorization");
    }
    return auth;
  },
);
