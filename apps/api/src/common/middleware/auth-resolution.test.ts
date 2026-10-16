import { resolveRequestAuth } from "./auth-resolution";
import { describe, expect, it } from "bun:test";

const user = { id: "user", role: "USER", email: "user@example.test" };

describe("verified authentication provenance", () => {
  it("distinguishes a verified session from a PAT without changing the principal", async () => {
    const calls: string[] = [];
    const verify = {
      session: async (token: string) => {
        calls.push(`session:${token}`);
        return token === "jwt" ? user : null;
      },
      agent: async (token: string) => {
        calls.push(`agent:${token}`);
        return token === "pat" ? user : null;
      },
    };
    expect(
      await resolveRequestAuth({ headers: {}, cookie: { accessToken: { value: "jwt" } } }, verify),
    ).toEqual({ user, authKind: "session_user" });
    expect(
      await resolveRequestAuth(
        { headers: { authorization: "Bearer pat" }, cookie: { accessToken: { value: "jwt" } } },
        verify,
      ),
    ).toEqual({ user, authKind: "agent" });
    expect(calls).toEqual(["session:jwt", "session:pat", "agent:pat"]);
    expect(user).not.toHaveProperty("authKind");
  });

  it("cannot derive human authorship from a header or an invalid bearer with a valid cookie", async () => {
    const verify = {
      session: async (token: string) => (token === "jwt" ? user : null),
      agent: async () => null,
    };
    expect(
      await resolveRequestAuth(
        {
          headers: { authorization: "Bearer invalid", authKind: "session_user" },
          cookie: { accessToken: { value: "jwt" } },
        },
        verify,
      ),
    ).toBeNull();
    expect(
      await resolveRequestAuth({ headers: { authKind: "session_user" }, cookie: {} }, verify),
    ).toBeNull();
  });
});
