import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bootstrapDiagnostic,
  databaseDiagnostic,
  environmentDiagnostic,
} from "./bootstrap-diagnostic.mjs";

test("bootstrap failures expose closed categories and codes, never raw import or database errors", () => {
  const secret = "password=do-not-copy-this";
  for (const error of [
    new Error(secret),
    { name: secret, code: secret, message: secret },
    { name: "PrismaClientKnownRequestError", code: "P2002", message: secret },
    { code: "ERR_MODULE_NOT_FOUND", message: secret },
  ])
    assert.ok(!JSON.stringify(bootstrapDiagnostic(error)).includes(secret));
  assert.deepEqual(bootstrapDiagnostic({ code: "P2002" }), {
    category: "database_error",
    code: "P2002",
  });
  assert.deepEqual(bootstrapDiagnostic(new TypeError("secret")), {
    category: "bootstrap_error",
    kind: "TypeError",
  });
});
test("environment diagnostics retain only bounded configuration field names", () => {
  assert.deepEqual(
    environmentDiagnostic([
      { path: ["TELEGRAM_BOT_USERNAME"], message: "secret" },
      { path: ["TELEGRAM_WEBHOOK_SECRET"] },
      { path: ["TELEGRAM_BOT_USERNAME"] },
      { path: ["private@example.test"] },
      { path: ["token=secret"] },
    ]),
    { category: "environment_error", paths: ["TELEGRAM_BOT_USERNAME", "TELEGRAM_WEBHOOK_SECRET"] },
  );
  assert.ok(
    environmentDiagnostic(Array.from({ length: 100 }, (_, i) => ({ path: [`FIELD_${i}`] }))).paths
      .length <= 50,
  );
});
test("database diagnostics extract only SQLSTATE and known constraint identity", () => {
  const error = {
    code: "P2039",
    message: "password=never-copy",
    meta: {
      cause: {
        originalCode: "23514",
        constraint: { name: "work_item_owned_slot" },
        originalMessage: "private failing row",
      },
    },
  };
  assert.deepEqual(databaseDiagnostic(error), {
    category: "database_error",
    code: "P2039",
    sqlstate: "23514",
    constraint: "work_item_owned_slot",
  });
  assert.deepEqual(
    databaseDiagnostic({
      code: "P2039",
      meta: { constraint: "a_private_secret", sqlstate: "secret" },
    }),
    { category: "database_error", code: "P2039" },
  );
  error.meta.cause.loop = error;
  assert.equal(databaseDiagnostic(error).sqlstate, "23514");
});
