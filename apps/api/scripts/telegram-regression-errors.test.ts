import { safeTelegramFailure } from "./telegram-regression-errors";
import { expect, test } from "bun:test";

test("reports only validated database identifiers, never invocation or adapter detail", () => {
  const secret = "postgresql://secret:credential@example.invalid/db";
  const diagnostic = safeTelegramFailure({
    code: "P2039",
    message: secret,
    meta: {
      driverAdapterError: {
        message: secret,
        cause: {
          originalCode: "23514",
          constraint: "application_question_answers_human_confirmation",
          detail: secret,
        },
      },
    },
  });
  expect(diagnostic).toEqual({
    category: "database_error",
    code: "P2039",
    sqlState: "23514",
    constraint: "application_question_answers_human_confirmation",
  });
  expect(JSON.stringify(diagnostic)).not.toContain(secret);
  expect(
    safeTelegramFailure({ code: "P2039", meta: { sqlState: secret, constraint: secret } }),
  ).toEqual({ category: "database_error", code: "P2039" });
});
