import { safeConcurrencyFailure, syntheticLoginUpdate } from "./concurrency-regression-guards";
import { describe, expect, it } from "bun:test";

describe("concurrency regression diagnostics", () => {
  it("limits the clone login mutation to the real password and verification fields", () => {
    expect(syntheticLoginUpdate("synthetic-hash")).toEqual({
      passwordHash: "synthetic-hash",
      emailVerified: true,
    });
  });

  it("never serializes invocation data, errors, hashes or arbitrary error codes", () => {
    const secret = "synthetic-password-hash-must-not-appear";
    const cases = [
      Object.assign(new Error(`update({passwordHash:'${secret}'})`), {
        name: "PrismaClientValidationError",
        invocation: secret,
      }),
      { name: "PrismaClientKnownRequestError", code: "P2002", message: secret, meta: secret },
      { name: "PrismaClientKnownRequestError", code: secret, message: secret },
      { name: "AssertionError", actual: secret, expected: "anything", message: secret },
      { name: "ZodError", issues: [{ input: secret }] },
      new Error(secret),
      secret,
    ];
    for (const error of cases)
      expect(JSON.stringify(safeConcurrencyFailure(error))).not.toContain(secret);
    expect(safeConcurrencyFailure(cases[0])).toEqual({ category: "database_error" });
    expect(safeConcurrencyFailure(cases[1])).toEqual({ category: "database_error", code: "P2002" });
    expect(safeConcurrencyFailure(cases[3])).toEqual({ category: "assertion_failed" });
  });
});
