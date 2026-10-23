import {
  applicationSubmissionSchema,
  submissionCheckpointInputSchema,
  submissionFieldSchema,
  submissionWorkerResultSchema,
} from "./submission";
import { describe, expect, it } from "bun:test";

const record = {
  version: 1,
  fields: [
    {
      id: "motivation",
      label: "Why this role?",
      type: "textarea",
      value: "I enjoy building reliable software.",
    },
  ],
  confirmation: {
    url: "https://employer.example/thanks",
    text: "Application received",
    observedAt: "2026-10-06T18:00:00.000Z",
  },
  resume: {
    jobId: "11111111-1111-4111-8111-111111111111",
    filename: "resume.pdf",
    sha256: "a".repeat(64),
  },
};

describe("application submission evidence", () => {
  it("requires every pre-submit review check and no unresolved issues", () => {
    const checkpoint = {
      fields: record.fields,
      resume: record.resume,
      resumeId: record.resume.jobId,
      review: {
        reviewedAt: record.confirmation.observedAt,
        summary: "Reviewed",
        checks: { job: true, fields: true, resume: true, factualClaims: true },
        issues: [],
      },
    };
    expect(submissionCheckpointInputSchema.safeParse(checkpoint).success).toBe(true);
    expect(
      submissionCheckpointInputSchema.safeParse({
        ...checkpoint,
        confirmation: record.confirmation,
      }).success,
    ).toBe(false);
    expect(
      submissionCheckpointInputSchema.safeParse({
        ...checkpoint,
        review: { ...checkpoint.review, issues: ["Unconfirmed answer"] },
      }).success,
    ).toBe(false);
    expect(
      submissionCheckpointInputSchema.safeParse({
        ...checkpoint,
        review: {
          ...checkpoint.review,
          checks: { ...checkpoint.review.checks, factualClaims: false },
        },
      }).success,
    ).toBe(false);
  });

  it("accepts only typed worker outcomes and supported pilot question kinds", () => {
    expect(
      submissionWorkerResultSchema.safeParse({ outcome: "applied", submitted: true }).success,
    ).toBe(false);
    expect(
      submissionWorkerResultSchema.safeParse({
        outcome: "recorded",
        checkpointId: record.resume.jobId,
      }).success,
    ).toBe(false);
    expect(
      submissionWorkerResultSchema.safeParse({
        outcome: "recording_pending",
        checkpointId: record.resume.jobId,
        context: "Receipt locally saved; retry recording only.",
      }).success,
    ).toBe(true);
    const question = {
      outcome: "needs_user",
      category: "eligibility",
      kind: "question",
      question: "Is this answer correct?",
    };
    expect(submissionWorkerResultSchema.safeParse(question).success).toBe(true);
    expect(
      submissionWorkerResultSchema.safeParse({ ...question, kind: "invented-kind" }).success,
    ).toBe(false);
  });
  it("requires a receipt and at least one captured field", () => {
    expect(applicationSubmissionSchema.safeParse(record).success).toBe(true);
    expect(
      applicationSubmissionSchema.safeParse({ ...record, confirmation: undefined }).success,
    ).toBe(false);
    expect(
      applicationSubmissionSchema.safeParse({
        ...record,
        confirmation: { ...record.confirmation, text: " " },
      }).success,
    ).toBe(false);
    expect(applicationSubmissionSchema.safeParse({ ...record, fields: [] }).success).toBe(false);
  });

  it("redacts passwords, one-time codes, hidden fields and named secrets", () => {
    for (const field of [
      { id: "account_password", label: "Create password", type: "password" },
      { id: "verification_code", label: "Verify account", type: "text" },
      { id: "otp", label: "Code", type: "number" },
      { id: "csrf", label: "Hidden state", type: "hidden" },
      { id: "answer", label: "Security answer", type: "text" },
      { id: "access_token", label: "Value", type: "text" },
      { id: "answer", label: "Confirm", type: "text", section: "Password" },
      { id: "otp_code", label: "Code", type: "text" },
      { id: "otpCode", label: "Code", type: "text" },
    ]) {
      expect(submissionFieldSchema.parse({ ...field, value: "do-not-store" })).toMatchObject({
        value: null,
        redacted: true,
      });
    }
  });

  it("retains typed answers and bounds free text", () => {
    expect(
      submissionFieldSchema.parse({
        id: "work",
        label: "Work authorization",
        type: "checkbox",
        value: true,
      }).value,
    ).toBe(true);
    expect(
      submissionFieldSchema.parse({
        id: "tech",
        label: "Skills",
        type: "multiselect",
        value: ["TypeScript", "C++"],
      }).value,
    ).toEqual(["TypeScript", "C++"]);
    expect(
      submissionFieldSchema.safeParse({
        id: "letter",
        label: "Letter",
        type: "textarea",
        value: "x".repeat(20001),
      }).success,
    ).toBe(false);
  });

  it("removes credentials, sensitive query values and fragments from confirmation links", () => {
    const parsed = applicationSubmissionSchema.parse({
      ...record,
      confirmation: {
        ...record.confirmation,
        url: "https://user:password@employer.example/thanks?job=123&token=private&session_id=private#access_token=private",
      },
    });
    expect(parsed.confirmation.url).toBe("https://employer.example/thanks?job=123");
  });

  it("rejects filesystem references and active receipt URLs", () => {
    expect(
      applicationSubmissionSchema.safeParse({
        ...record,
        resume: { ...record.resume, filename: "../resume.pdf" },
      }).success,
    ).toBe(false);
    expect(
      applicationSubmissionSchema.safeParse({
        ...record,
        resume: { ...record.resume, sha256: "../private" },
      }).success,
    ).toBe(false);
    expect(
      applicationSubmissionSchema.safeParse({
        ...record,
        confirmation: { ...record.confirmation, url: "javascript:alert(1)" },
      }).success,
    ).toBe(false);
  });
});
