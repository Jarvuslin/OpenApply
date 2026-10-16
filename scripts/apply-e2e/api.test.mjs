import assert from "node:assert/strict";
import test from "node:test";
import { createRedactor, requireLoopback } from "./api.mjs";

test("harness accepts only credential-free loopback origins", () => {
  assert.throws(() => requireLoopback("https://example.com"));
  assert.throws(() => requireLoopback("http://user:password@127.0.0.1"));
  assert.equal(requireLoopback("http://127.0.0.1:14101").port, "14101");
});

test("redaction keeps synthetic authorization answers and hashes while removing credentials", () => {
  const redactor = createRedactor();
  redactor.add("generated-secret");
  const result = redactor.clean({
    password: "password",
    accessToken: "token",
    token: "terminal-token",
    workAuthorization: "yes",
    sha256: "abc",
    message: "contains generated-secret",
    authorization: "Bearer other-token",
  });
  assert.equal(result.workAuthorization, "yes");
  assert.equal(result.sha256, "abc");
  assert.equal(result.password, "[redacted]");
  assert.equal(result.token, "[redacted]");
  assert.equal(result.message, "contains [redacted]");
  assert.equal(result.authorization, "[redacted]");
});
