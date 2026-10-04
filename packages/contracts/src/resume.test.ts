import { optionalPhoneSchema } from "./phone";
import { resumeDataSchema } from "./resume";
import { expect, it } from "bun:test";

it("preserves local resume phone formatting while applicant phones remain validated", () => {
  const result = resumeDataSchema.parse({
    basics: { name: "Example Applicant", phone: "437-555-0123" },
  });
  expect(result.basics.phone).toBe("437-555-0123");
  expect(optionalPhoneSchema.safeParse("437-555-0123").success).toBe(false);
});
