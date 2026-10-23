import { setupChecksSchema } from "./setup-checks";
import { describe, expect, test } from "bun:test";

const row = { id: "git", label: "Git", status: "ok", required: true, detail: "2.54", fix: "" };

describe("setupChecksSchema", () => {
  test("accepts the doctor's JSON", () => {
    expect(setupChecksSchema.parse({ checks: [row] }).checks[0]?.id).toBe("git");
  });

  test("rejects an unknown status or a missing fix", () => {
    expect(setupChecksSchema.safeParse({ checks: [{ ...row, status: "pass" }] }).success).toBe(
      false,
    );
    const { fix: _, ...withoutFix } = row;
    expect(setupChecksSchema.safeParse({ checks: [withoutFix] }).success).toBe(false);
  });
});
