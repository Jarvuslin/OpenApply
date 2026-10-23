// CI gate for `doctor --json` output: fails on any required check that failed,
// except the ids in ALLOWED_FAILURES (comma-separated) that a runner cannot satisfy.
import { readFileSync } from "node:fs";

const file = process.argv[2];
const { checks } = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, ""));
const allowed = new Set((process.env.ALLOWED_FAILURES ?? "").split(",").filter(Boolean));
for (const check of checks)
  console.log(`${check.status.padEnd(7)} ${check.label}: ${check.detail}`);
const blocking = checks.filter(
  (check) => check.required && check.status === "fail" && !allowed.has(check.id),
);
if (blocking.length) {
  console.error(`\nRequired checks failed: ${blocking.map((check) => check.id).join(", ")}`);
  process.exit(1);
}
console.log(
  `\nAll required checks passed (allowed to fail here: ${[...allowed].join(", ") || "none"}).`,
);
