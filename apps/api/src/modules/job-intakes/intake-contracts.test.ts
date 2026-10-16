import {
  intakeCreateSchema,
  intakeDecisionSchema,
  intakePrepareSchema,
} from "@openapply/contracts/job-intake";
import { canonicalizeIntakeUrl } from "@/modules/application/job-url";
import { intakeUrl } from "./intake-resolver";
import { describe, expect, it } from "bun:test";

const requestId = "f75ccdb6-21af-40d3-b217-9fe2d7223f4e";

describe("strict intake commands", () => {
  it("accepts only a link and idempotency key at intake creation", () => {
    const input = { requestId, url: "https://jobs.example.test/123" };
    expect(intakeCreateSchema.parse(input)).toEqual(input);
    for (const extra of [
      { authorship: "session_user" },
      { decision: "apply_now" },
      { provider: "codex" },
      { modelGrant: true },
      { confirmed: true },
    ])
      expect(intakeCreateSchema.safeParse({ ...input, ...extra }).success).toBe(false);
  });

  it("requires an exact revision and an explicit supported decision", () => {
    const input = { requestId, expectedRevision: 1, decision: "queue" as const };
    expect(intakeDecisionSchema.parse(input)).toEqual(input);
    for (const decision of ["pending", "apply", "approve", "apply to similar jobs"]) {
      expect(intakeDecisionSchema.safeParse({ ...input, decision }).success).toBe(false);
    }
    for (const expectedRevision of [undefined, 0, -1, 1.5, "1"]) {
      expect(intakeDecisionSchema.safeParse({ ...input, expectedRevision }).success).toBe(false);
    }
  });

  it("never carries a spending grant, authored provenance, or broad scope in decisions", () => {
    const input = { requestId, expectedRevision: 1, decision: "apply_now" };
    for (const extra of [
      { budget: 100 },
      { modelGrant: true },
      { authorship: "telegram_user" },
      { jobIds: [requestId] },
      { all: true },
    ]) {
      expect(intakeDecisionSchema.safeParse({ ...input, ...extra }).success).toBe(false);
    }
  });

  it("keeps preparation pinned and separate from application or grant authorization", () => {
    // This fixture validates data only; it neither selects nor executes a provider.
    const input = { requestId, expectedRevision: 1, provider: "codex" as const };
    expect(intakePrepareSchema.parse(input)).toEqual(input);
    expect(intakePrepareSchema.safeParse({ requestId, expectedRevision: 1 }).success).toBe(false);
    for (const extra of [
      { decision: "apply_now" },
      { budget: 1 },
      { resumeId: requestId },
      { authorship: "session_user" },
    ]) {
      expect(intakePrepareSchema.safeParse({ ...input, ...extra }).success).toBe(false);
    }
  });

  it("rejects missing or malformed idempotency keys and oversized links", () => {
    for (const value of [undefined, "", "request-1"]) {
      expect(
        intakeCreateSchema.safeParse({ requestId: value, url: "https://jobs.example.test/1" })
          .success,
      ).toBe(false);
    }
    expect(
      intakeCreateSchema.safeParse({
        requestId,
        url: `https://jobs.example.test/${"x".repeat(2000)}`,
      }).success,
    ).toBe(false);
  });
});

describe("intake URL identity and public input boundary", () => {
  it.each([
    [
      "https://jobs.lever.co/acme/abc/apply/?utm_source=chat#form",
      "https://jobs.lever.co/acme/abc",
    ],
    [
      "https://jobs.ashbyhq.com/acme/abc/application?utm_medium=chat",
      "https://jobs.ashbyhq.com/acme/abc",
    ],
    [
      "https://Jobs.Example.test/AbC/?b=2&utm_source=x&a=1#form",
      "https://jobs.example.test/AbC?a=1&b=2",
    ],
  ])("folds known aliases for %s", (input, expected) => {
    expect(intakeUrl(input)).toBe(expected);
    expect(canonicalizeIntakeUrl(expected)).toBe(expected);
  });

  it("does not merge unrelated form suffixes or job identity parameters", () => {
    expect(intakeUrl("https://jobs.example.test/acme/123/apply")).toBe(
      "https://jobs.example.test/acme/123/apply",
    );
    expect(intakeUrl("https://jobs.example.test/view?jobId=1")).not.toBe(
      intakeUrl("https://jobs.example.test/view?jobId=2"),
    );
  });

  it.each([
    "not a url",
    "http://jobs.example.test/1",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://person:secret@jobs.example.test/1",
    "https://jobs.example.test:8443/1",
    "https://localhost/1",
    "https://company.local/1",
    "https://127.0.0.1/1",
    "https://2130706433/1",
    "https://[::1]/1",
  ])("rejects unsupported intake input %s", (url) => {
    expect(() => intakeUrl(url)).toThrow();
  });
});
