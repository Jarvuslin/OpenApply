import { forbidden } from "@/common/errors";

/** Registration follows a browser-owned companion check; an agent PAT alone cannot attest it. */
export async function requireConnectorBrowserSession(
  userId: string,
  accessToken: unknown,
  verifySession: (token: string) => Promise<{ id: string } | null>,
) {
  if (typeof accessToken !== "string" || !accessToken) {
    throw forbidden("Register a checked mailbox from OpenApply's email settings.");
  }
  const sessionUser = await verifySession(accessToken);
  if (sessionUser?.id !== userId) {
    throw forbidden("Mailbox registration requires the matching browser session.");
  }
}
