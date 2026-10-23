import type { AuthUser } from "@/common/auth/types";

export type AuthKind = "session_user" | "telegram_user" | "agent";

export interface AuthContext {
  headers: Record<string, string | undefined>;
  cookie: Record<string, { value: unknown } | undefined>;
}

interface Verifiers {
  session: (token: string) => Promise<AuthUser | null>;
  agent: (token: string) => Promise<AuthUser | null>;
}

/** Authorship follows the verified token, never a body field or unverified token shape. */
export async function resolveRequestAuth({ headers, cookie }: AuthContext, verify: Verifiers) {
  const authorization = headers.authorization;
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  const cookieToken = cookie.accessToken?.value;
  const token = bearer ?? (typeof cookieToken === "string" ? cookieToken : undefined);
  if (!token) return null;
  if (/^(prep|account)\./i.test(token)) return null;
  const sessionUser = await verify.session(token);
  if (sessionUser) return { user: sessionUser, authKind: "session_user" as const };
  const agentUser = await verify.agent(token);
  return agentUser ? { user: agentUser, authKind: "agent" as const } : null;
}
