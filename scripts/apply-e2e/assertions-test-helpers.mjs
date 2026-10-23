import { sha256 } from "./api.mjs";
import { CASES, expectedWhyUs, SYNTHETIC_APPLICANT } from "./cases.mjs";

export function caseEvidence(caseId = "greenhouse") {
  const originalText =
    "Built accessible React and TypeScript application dashboards with PostgreSQL and automated tests.";
  const pdf = Buffer.from("%PDF-1.7\nUnit-test bytes; not a real agent artifact.");
  const fixture = {
    ...CASES.find((item) => item.id === caseId),
    url: `http://127.0.0.1:14110/runs/unit/${caseId}`,
    description:
      "Complete synthetic posting with TypeScript, React, Node.js, PostgreSQL and automated testing.",
    fields: [],
  };
  const fields = {
    ...Object.fromEntries(fixture.nameFields.map((name) => [name, SYNTHETIC_APPLICANT[name]])),
    email: SYNTHETIC_APPLICANT.email,
    workAuthorization: "yes",
    [fixture.sponsorshipField]: fixture.expectedSponsorship,
    sponsorshipDetails: SYNTHETIC_APPLICANT.sponsorshipDetails,
    whyUs: expectedWhyUs(fixture),
  };
  const receipt = {
    id: "receipt-unit",
    url: "http://127.0.0.1:14110/runs/unit/receipts/receipt-unit",
    text: "Application received. Receipt receipt-unit.",
  };
  const resume = { sha256: sha256(pdf), artifact: { revision: "c".repeat(64) } };
  const canonicalUrl = fixture.url.replace(/^http:/, "https:");
  const checkpoint = {
    job: { id: "job-unit", url: fixture.url, canonicalUrl },
    resumeId: "resume-unit",
    resumeVariantId: "variant-unit",
    fields: Object.entries(fields).map(([id, value]) => ({ id, label: id, type: "text", value })),
    resume,
    review: { checks: { job: true, fields: true, resume: true, factualClaims: true }, issues: [] },
  };
  const confirmation = { url: receipt.url, reference: receipt.id, text: receipt.text };
  const rewrites = {
    experience: [
      {
        bullets: [
          {
            original: originalText,
            tailored:
              "Built accessible application dashboards with React, TypeScript, PostgreSQL, and automated tests.",
            grounding: { evidence: [{ path: "/experience/0/bullets/0", quote: originalText }] },
          },
        ],
      },
    ],
  };
  const attempt = {
    id: "attempt-unit",
    originalUrl: fixture.url,
    canonicalUrl,
    jobId: "job-unit",
    state: "recorded",
    startedAt: "2026-10-08T10:00:01Z",
    recordedAt: "2026-10-08T10:00:10Z",
    checkpointId: "checkpoint-unit",
    checkpoint,
    receipt: { checkpointId: "checkpoint-unit", confirmation },
    receiptStoredAt: "2026-10-08T10:00:09Z",
    applicationId: "application-unit",
  };
  return {
    fixture,
    submissions: [
      { caseId, fields, resume: { sha256: sha256(pdf) }, receipt, submissionRequests: 1 },
    ],
    originalText,
    sourceText: originalText,
    resumeId: "resume-unit",
    startedAt: "2026-10-08T10:00:00Z",
    checkpointPdf: pdf,
    applicationPdf: pdf,
    job: {
      id: "job-unit",
      campaignId: "campaign-unit",
      status: "applied",
      description: fixture.description,
      matchScore: 90,
      fitAssessment: {
        basis: {
          resumeId: "resume-unit",
          sourceSha256: sha256(originalText),
          sourceTextSha256: sha256(originalText),
        },
        score: 90,
        assessments: [{ evidence: [{ start: 0, end: originalText.length, quote: originalText }] }],
      },
    },
    attempt,
    application: {
      id: "application-unit",
      url: canonicalUrl,
      campaignId: "campaign-unit",
      status: "applied",
      submission: { confirmation, resume, fields: structuredClone(checkpoint.fields) },
      resumeVariantUsed: { id: "variant-unit" },
    },
    variant: {
      id: "variant-unit",
      resumeId: "resume-unit",
      jobUrl: fixture.url,
      createdAt: "2026-10-08T10:00:02Z",
      rewrites,
    },
    artifact: {
      pdfSha256: sha256(pdf),
      revision: "c".repeat(64),
      variantId: "variant-unit",
      job: { url: fixture.url },
      validation: { valid: true },
      source: { sha256: sha256(originalText) },
      audit: structuredClone(rewrites),
      content: { experience: [{ bullets: [rewrites.experience[0].bullets[0].tailored] }] },
    },
    workerCheck: {
      valid: true,
      outcome: "recorded",
      attempt: { applicationId: "application-unit", checkpointId: "checkpoint-unit" },
    },
  };
}
