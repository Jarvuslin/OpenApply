import { setup } from "./fakes";
import { describe, expect, it } from "bun:test";

describe("job context mutation fence", () => {
  for (const operation of ["patch", "rescan"] as const)
    it(`waits for answer confirmation before ${operation} and rejects a stale posting version`, async () => {
      const reached = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const f = setup(async () => {
        reached.resolve();
        await release.promise;
      });
      f.setStatus(operation === "patch" ? "pending" : "skipped");
      const result =
        operation === "patch"
          ? f.service.patchJob("u1", "c1", "j1", { company: "New employer" })
          : f.service.rescanJob("u1", "c1", "j1", { action: "refresh", company: "New employer" });
      const outcome = result.then(
        () => null,
        (error: unknown) => error,
      );
      await reached.promise;
      expect(f.job.company).toBe("Acme");
      // A confirmation committed while this edit waited for the shared user lock.
      f.job.updatedAt = new Date(f.job.updatedAt.getTime() + 1);
      release.resolve();
      expect(await outcome).toMatchObject({ status: 409 });
      expect(f.job.company).toBe("Acme");
    });
});
