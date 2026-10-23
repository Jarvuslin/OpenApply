// Contracts is zod-only, so this test pulls in no env and no Prisma.
import { hasRole } from "@openapply/contracts/role";
import { describe, expect, it } from "bun:test";

describe("role ladder", () => {
  it("lets SUPER_ADMIN satisfy every requirement", () => {
    expect(hasRole("SUPER_ADMIN", "SUPER_ADMIN")).toBe(true);
    expect(hasRole("SUPER_ADMIN", "ADMIN")).toBe(true);
    expect(hasRole("SUPER_ADMIN", "USER")).toBe(true);
  });

  it("lets ADMIN satisfy ADMIN and USER but never SUPER_ADMIN", () => {
    expect(hasRole("ADMIN", "ADMIN")).toBe(true);
    expect(hasRole("ADMIN", "USER")).toBe(true);
    // The old guard short-circuited on `user.role !== "ADMIN"`, so an ADMIN passed requireRole("SUPER_ADMIN").
    expect(hasRole("ADMIN", "SUPER_ADMIN")).toBe(false);
  });

  it("lets USER satisfy nothing above USER", () => {
    expect(hasRole("USER", "USER")).toBe(true);
    expect(hasRole("USER", "ADMIN")).toBe(false);
    expect(hasRole("USER", "SUPER_ADMIN")).toBe(false);
  });

  it("rejects a role that is not on the ladder", () => {
    // The JWT claim is untrusted, so this is the case that matters.
    expect(hasRole(undefined, "USER")).toBe(false);
    expect(hasRole("", "USER")).toBe(false);
    expect(hasRole("root", "USER")).toBe(false);
    expect(hasRole("super_admin", "ADMIN")).toBe(false);
  });
});
