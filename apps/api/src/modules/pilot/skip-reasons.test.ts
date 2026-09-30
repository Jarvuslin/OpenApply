import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifySkipReason, SERVER_SKIP_REASONS, type SkipBucket } from "./skip-reasons";
import { describe, expect, it } from "bun:test";

// The classifier matches prose the agent is told to write, so a reworded doc must fail here.
describe("the phrasings eligibility.md prescribes", () => {
  const doc = readFileSync(
    join(import.meta.dir, "../../../../../plugin/skills/_shared/eligibility.md"),
    "utf8",
  ).toLowerCase();

  const prescribed: [phrase: string, reason: string, bucket: SkipBucket][] = [
    ["already applied (", "Already applied (url)", "alreadyApplied"],
    ["below minimum match score (", "Below minimum match score (52 < 60)", "belowMinScore"],
    [
      "captcha - apply manually via the apply skill",
      "CAPTCHA - apply manually via the apply skill",
      "captcha",
    ],
    ["payment required", "Payment required", "payment"],
    ["us citizenship required", "US citizenship required", "citizenship"],
    ["active security clearance required", "Active security clearance required", "clearance"],
    [
      'no visa sponsorship (jd: "',
      'No visa sponsorship (JD: "we cannot sponsor visas")',
      "sponsorship",
    ],
  ];

  for (const [phrase, reason, bucket] of prescribed) {
    it(`still asks for "${phrase}" and buckets it as ${bucket}`, () => {
      expect(doc).toContain(phrase);
      expect(classifySkipReason(reason)).toBe(bucket);
    });
  }
});

describe("classifySkipReason", () => {
  it("buckets closed postings, and anything unrecognized as other", () => {
    expect(classifySkipReason("Posting is no longer accepting applications")).toBe("postingClosed");
    expect(classifySkipReason("Recruiter asked for a portfolio we don't have")).toBe("other");
  });

  it("ignores case, and reports sponsorship when a reason names both bars", () => {
    expect(classifySkipReason("us CITIZENSHIP required")).toBe("citizenship");
    expect(classifySkipReason("US citizenship required, no sponsorship offered")).toBe(
      "sponsorship",
    );
  });

  // A reworded literal at the call site must fail here rather than demote its skips to `other`.
  for (const [bucket, reason] of Object.entries(SERVER_SKIP_REASONS)) {
    it(`buckets the server's own "${reason}" as ${bucket}`, () => {
      expect(classifySkipReason(reason)).toBe(bucket as SkipBucket);
    });
  }
});
