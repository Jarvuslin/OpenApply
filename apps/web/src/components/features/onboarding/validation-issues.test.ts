import { describeIssues, firstStepWithIssue } from "./validation-issues";
import { expect, test } from "bun:test";

test("validation returns users to the field's Resume-first step", () => {
  const issues = describeIssues([
    { path: ["firstName"], message: "Required" },
    { path: ["workAuthorization", 0, "country"], message: "Required" },
    { path: ["jobPreferences", "roles"], message: "Choose a role" },
  ]);
  expect(issues.map((issue) => issue.stepIndex)).toEqual([1, 2, 3]);
  expect(firstStepWithIssue(issues)).toBe(1);
});
