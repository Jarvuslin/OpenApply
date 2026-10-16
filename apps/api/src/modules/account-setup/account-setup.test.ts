import {
  accountSetupSnapshotSchema,
  enqueueAccountSetupSchema,
} from "@openapply/contracts/account-setup";
import { toInputJson } from "@/common/json";
import { resolveRequestAuth } from "@/common/middleware/auth-resolution";
import {
  accountSetupCredential,
  accountSetupUrls,
  storedAccountSetup,
} from "./account-setup.snapshot";
import { accountFixture } from "./fakes";
import { describe, expect, it } from "bun:test";

describe("bounded account setup", () => {
  it("requires the exact owned credential and exact normalized email, never a default lookup", async () => {
    const f = accountFixture();
    await expect(
      f.service.enqueue(crypto.randomUUID(), f.input, "session_user"),
    ).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      f.service.enqueue(
        f.userId,
        { ...f.input, credentialId: crypto.randomUUID() },
        "session_user",
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.service.enqueue(f.userId, { ...f.input, email: "different@example.com" }, "session_user"),
    ).rejects.toThrow("email");
    const result = await f.service.enqueue(
      f.userId,
      {
        ...f.input,
        email: "APPLICANT@EXAMPLE.COM",
      },
      "session_user",
    );
    expect(result.snapshot.email).toBe(f.credential.email);
    expect(result.snapshot.accountStatus).toBe("unknown");
    expect(f.reads.every((read) => Object.keys(read).sort().join() === "id,userId")).toBe(true);
    expect(f.secrets.reads).toBe(0);
  });

  it("rejects unsupported URLs and cross-tenant destinations", () => {
    for (const url of [
      "http://careers.example.com/signup",
      "https://localhost/signup",
      "https://10.0.0.1/signup",
      "https://127.0.0.1/signup",
      "https://user:password@careers.example.com/signup",
      "https://[::1]/signup",
      "https://foo.internal/signup",
    ])
      expect(() => accountSetupUrls(url, new URL(url).origin)).toThrow();
    expect(() =>
      accountSetupUrls("https://other.example.com/signup", "https://careers.example.com"),
    ).toThrow("origin");
    expect(() =>
      accountSetupUrls("https://careers.example.com/signup", "https://careers.example.com/path"),
    ).toThrow("origin");
    expect(() =>
      accountSetupUrls("https://careers.example.com./signup", "https://careers.example.com."),
    ).toThrow("trailing-dot");
  });

  it("opens a Workday job or apply link at its site root", () => {
    const origin = "https://capitalone.wd12.myworkdayjobs.com";
    expect(
      accountSetupUrls(
        `${origin}/en-US/Capital_One/job/Toronto/X_R1/apply/applyManually?s=1`,
        origin,
      ).signupUrl,
    ).toBe(`${origin}/en-US/Capital_One`);
    expect(accountSetupUrls(`${origin}/Capital_One/job/X_R1`, origin).signupUrl).toBe(
      `${origin}/Capital_One`,
    );
  });

  it("rejects any scope other than the job login even with the exact ID and email", async () => {
    for (const scope of [
      "other.example.com",
      "example.com",
      "*.example.com",
      "careers.example.com/path",
      "careers.example.com.",
    ]) {
      const f = accountFixture();
      f.credential.scope = scope;
      await expect(f.enqueue()).rejects.toThrow("job login");
      expect(f.workItems).toHaveLength(0);
      expect(f.secrets.reads).toBe(0);
    }
  });

  it("is idempotent and blocks new request IDs from replaying one tenant/email", async () => {
    const f = accountFixture();
    const first = await f.enqueue();
    expect(await f.enqueue()).toEqual(first);
    await expect(
      f.service.enqueue(
        f.userId,
        { ...f.input, signupUrl: `${f.input.signupUrl}/other` },
        "session_user",
      ),
    ).rejects.toThrow("different details");
    await expect(
      f.service.enqueue(
        f.userId,
        { ...f.input, idempotencyKey: crypto.randomUUID() },
        "session_user",
      ),
    ).rejects.toThrow("never retry");
    expect(f.workItems).toHaveLength(1);
  });

  it("binds strict immutable snapshots and never accepts secret or application fields", async () => {
    const f = accountFixture();
    const { snapshot } = await f.enqueue();
    for (const field of ["password", "resumeId", "jobId", "applicationId"])
      expect(accountSetupSnapshotSchema.safeParse({ ...snapshot, [field]: "forged" }).success).toBe(
        false,
      );
    expect(enqueueAccountSetupSchema.safeParse({ ...f.input, password: "secret" }).success).toBe(
      false,
    );
    const original = f.item().payload;
    const attempt = storedAccountSetup(f.item()).attempt;
    for (const change of [
      { signupUrl: `${snapshot.signupUrl}/changed` },
      { email: "else@example.com" },
      { credentialId: crypto.randomUUID() },
      { workItemId: crypto.randomUUID() },
      { accountStatus: "absent_confirmed" },
    ]) {
      f.workItems[0].payload = toInputJson({
        snapshot: { ...snapshot, ...change },
        attempt,
      });
      expect(() => storedAccountSetup(f.item())).toThrow("scope");
    }
    f.item().payload = original;
    expect(storedAccountSetup(f.item()).snapshot).toEqual(snapshot);
  });

  it("isolates account capabilities from normal account auth and all other capability types", async () => {
    const f = accountFixture();
    const { authorization } = await f.start();
    expect(accountSetupCredential(authorization).workItemId).toBe(f.item().id);
    for (const token of [
      undefined,
      "Bearer normal-pat",
      authorization.replace("account.", "prep."),
      `${authorization}.extra`,
    ])
      expect(() => accountSetupCredential(token)).toThrow();
    let calls = 0;
    expect(
      await resolveRequestAuth(
        { headers: { authorization }, cookie: { accessToken: { value: "valid-cookie" } } },
        {
          session: async () => {
            calls++;
            return null;
          },
          agent: async () => {
            calls++;
            return null;
          },
        },
      ),
    ).toBeNull();
    expect(calls).toBe(0);
  });
});
