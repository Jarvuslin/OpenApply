import type { Prisma } from "../src/generated/prisma/client";

export function syntheticLoginUpdate(passwordHash: string) {
  return { passwordHash, emailVerified: true } satisfies Prisma.UserUpdateInput;
}

// Prisma errors may contain the entire invocation, including password hashes. Reports
// retain only a closed diagnostic category and a validated engine error code.
export function safeConcurrencyFailure(error: unknown) {
  if (!error || typeof error !== "object") return { category: "unexpected_error" };
  const name = "name" in error ? error.name : null;
  const code = "code" in error ? error.code : null;
  if (typeof code === "string" && /^P\d{4}$/.test(code))
    return { category: "database_error", code };
  if (typeof name === "string" && name.startsWith("PrismaClient"))
    return { category: "database_error" };
  if (name === "AssertionError") return { category: "assertion_failed" };
  if (name === "ZodError") return { category: "validation_error" };
  return { category: "unexpected_error" };
}
