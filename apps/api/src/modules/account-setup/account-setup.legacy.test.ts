import { accountFixture } from "./fakes";
import { describe, expect, it } from "bun:test";

describe("preserved employer account replay guard", () => {
  it("blocks a consumed legacy identity before pinning or enqueueing, including tenant path scopes", async () => {
    for (const scope of ["careers.example.com", "CAREERS.EXAMPLE.COM/Workday"])
      for (const state of ["needs_user", "authenticated", "unknown", "skipped"]) {
        const f = accountFixture();
        const query = f.db.$queryRaw.bind(f.db);
        f.db.$queryRaw = (async (sql: TemplateStringsArray, ...values: unknown[]) => {
          if (sql.join("").includes("FROM employer_account_attempts")) {
            expect(values).toEqual([f.userId, f.input.email, "careers.example.com"]);
            expect(sql.join("")).toContain("split_part");
            return [
              {
                id: "febbe2be-830e-4f20-81a3-a92cb5fb4d2a",
                scope,
                state,
                signupStartedAt: new Date(),
              },
            ];
          }
          return query(sql, ...values);
        }) as typeof f.db.$queryRaw;
        await expect(f.enqueue()).rejects.toThrow("preserved employer account attempt");
        expect(f.workItems).toHaveLength(0);
        expect(f.workRequests).toHaveLength(0);
        expect(f.credentials).toHaveLength(1);
        expect(f.credential.password).toBe("encrypted.synthetic.secret");
      }
  });

  it("keeps inspection-only provenance across later manual handoffs before any signup", async () => {
    const f = accountFixture();
    const initial = await f.start();
    await f.service.observe(initial.authorization, {
      event: "unknown",
      browserSessionId: initial.claim.ownership.browserSessionId,
      currentUrl: f.input.signupUrl,
    });
    await f.queue.finish(f.userId, f.item().id, {
      leaseToken: initial.claim.leaseToken,
      status: "waiting",
    });
    const review = await f.service.continue(
      f.userId,
      f.item().id,
      { expectedRevision: 1, action: "continue" },
      "session_user",
    );
    const claim = (
      await f.queueClaims.claim(
        f.userId,
        f.claimInput(review.item.id, review.context.snapshot.snapshotHash),
      )
    ).claim!;
    const auth = `Bearer ${claim.execution.accountSetup!.apiToken}`;
    await f.service.observe(auth, {
      event: "needs_user",
      reason: "captcha",
      browserSessionId: claim.ownership.browserSessionId,
      currentUrl: f.input.signupUrl,
    });
    await f.queue.finish(f.userId, f.item().id, {
      leaseToken: claim.leaseToken,
      status: "waiting",
    });
    const again = await f.service.continue(
      f.userId,
      f.item().id,
      { expectedRevision: 2, action: "continue" },
      "session_user",
    );
    expect(again.context.snapshot).toMatchObject({ revision: 3, operation: "inspect" });
    expect(again.context.attempt.signupAttempts).toBe(0);
  });
});
