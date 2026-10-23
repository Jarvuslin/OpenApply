import { EMPTY_RESUME_DATA, type ResumeData } from "@openapply/contracts/resume";
import type { ResumeEvidenceSnapshot } from "@openapply/contracts/resume-evidence";
import { HttpError } from "@/common/errors";
import { type TailorVariantBody, variantDetailSchema } from "../variants/variant.schema";
import { buildTailoredVariant } from "./build-variant";
import { grounding, workflowReview } from "./fakes";
import { describe, expect, test } from "bun:test";

const original = "Built Python scripts for reports.";
const explanation =
  "Used SQL queries and validation checks to reject incomplete report rows before export.";
const source: ResumeData = {
  ...EMPTY_RESUME_DATA,
  basics: { name: "Sample Applicant" },
  experience: [{ company: "ExampleCo", title: "Intern", start: "2024", bullets: [original] }],
};

function snapshot(statement = explanation): ResumeEvidenceSnapshot {
  return {
    id: "c15b9d39-0024-4ef8-89f5-8c6b28e06e98",
    resumeId: "4dbb4813-2f5d-4356-a887-037f20d6e5c5",
    revision: 1,
    status: "supported",
    scope: "/experience/0",
    statement,
    source: { kind: "resume", version: 1, path: "/experience/0", quote: statement },
    review: {
      claimType: "explicit",
      context: "personal_assertion",
      rationale: "User described the work for this employment.",
    },
    verification: {
      resumeVersion: 1,
      scopeSha256: "b".repeat(64),
      sourceSha256: "a".repeat(64),
      sourceRecord: "resume:4dbb4813-2f5d-4356-a887-037f20d6e5c5:1:/experience/0",
      sourceUrl: null,
      authorLogin: null,
      limitation: "Personal assertion, not independent proof.",
    },
    optionalQuestion: null,
    createdAt: "2026-10-07T00:00:00.000Z",
    updatedAt: "2026-10-07T00:00:00.000Z",
  };
}

function request(
  evidence: ResumeEvidenceSnapshot,
  tailored = "Built Python report scripts with SQL queries and validation checks that rejected incomplete rows before export.",
): TailorVariantBody {
  const review = grounding("/experience/0/bullets/0", original);
  review.externalEvidence = [
    { evidenceId: evidence.id, revision: evidence.revision, quote: evidence.statement },
  ];
  return {
    label: "Evidence preview",
    bulletRewrites: [{ entryIndex: 0, bullets: [{ original, tailored, grounding: review }] }],
    workflowReview: workflowReview(),
  };
}

function violations(body: TailorVariantBody, evidence: ResumeEvidenceSnapshot[]): string[] {
  try {
    buildTailoredVariant(source, body, evidence);
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    return (error as HttpError).details as string[];
  }
  throw new Error("Expected a validation failure");
}

describe("resolved supplemental rewrite evidence", () => {
  test("supports substantive method and capability detail beyond the former growth cap", () => {
    const evidence = snapshot();
    const result = buildTailoredVariant(source, request(evidence), [evidence]);
    expect(result.content.experience[0].bullets[0]).toContain("SQL queries and validation checks");
    expect(result.audit?.additionalEvidence).toEqual([evidence]);
    expect(result.audit?.workflowReview?.reviewer.status).toBe("completed");
    expect(result.audit?.reviewEvidenceMeaning).toContain("not established");
    expect(variantDetailSchema.shape.rewrites.safeParse(result.audit).success).toBe(true);
    expect(source.experience[0].bullets).toEqual([original]);
  });

  test("refuses unresolved, stale, retracted and wrong-entry evidence", () => {
    const evidence = snapshot();
    for (const snapshots of [
      [],
      [{ ...evidence, revision: 2 }],
      [{ ...evidence, status: "retracted" as const }],
      [{ ...evidence, scope: "/projects/0" }],
    ]) {
      expect(violations(request(evidence), snapshots).join(" ")).toContain("external evidence");
    }
  });

  test("requires the full statement rather than a cherry-picked clause", () => {
    const evidence = snapshot("Did not use SQL queries in this employment.");
    const body = request(evidence);
    const refs = body.bulletRewrites?.[0].bullets[0].grounding.externalEvidence;
    if (refs) refs[0].quote = "SQL queries";
    expect(violations(body, [evidence]).join(" ")).toContain("complete saved statement");
  });

  test("retains the original anchor and rejects invented or dropped tools after enrichment", () => {
    const evidence = snapshot();
    expect(
      violations(
        request(evidence, "Built Python report scripts with Kubernetes and SQL queries."),
        [evidence],
      ).join(" "),
    ).toContain("Kubernetes");
    expect(
      violations(request(evidence, "Built report scripts with SQL queries."), [evidence]).join(" "),
    ).toContain("drops tech");
    const body = request(evidence);
    if (body.bulletRewrites) body.bulletRewrites[0].bullets[0].grounding.evidence = [];
    expect(violations(body, [evidence]).join(" ")).toContain("complete original bullet");
  });

  test("accepts a new measurement only with its complete exact outcome statement", () => {
    const evidence = snapshot(
      "Reduced report preparation time by 30% through validation before export.",
    );
    const exact = `${original} ${evidence.statement}`;
    expect(buildTailoredVariant(source, request(evidence, exact), [evidence]).rewordedBullets).toBe(
      1,
    );
    for (const tailored of [
      "Built Python scripts that cut costs by 30%.",
      "Built Python scripts that reduced report preparation time by 30%.",
      `${original} ${evidence.statement.replace("30%", "30")}`,
    ]) {
      expect(violations(request(evidence, tailored), [evidence]).join(" ")).toContain(
        "complete cited outcome statement",
      );
    }
  });
});

describe("rewrite workflow accountability", () => {
  test("changed prose cannot silently omit the review process", () => {
    const evidence = snapshot();
    expect(
      violations({ ...request(evidence), workflowReview: undefined }, [evidence]).join(" "),
    ).toContain("requires workflowReview");
  });

  test("unavailable tools are recorded as incomplete and optional questions never block", () => {
    const evidence = snapshot();
    const body = request(evidence);
    body.workflowReview = {
      ...workflowReview(),
      reviewer: {
        status: "unavailable",
        reason: "No independent agent is available in this runtime.",
      },
      humanizer: { status: "unavailable", reason: "Skill invocation was denied by the runtime." },
      optionalQuestions: ["How long did the reporting step take before automation?"],
    };
    const result = buildTailoredVariant(source, body, [evidence]);
    expect(result.flags).toHaveLength(2);
    expect(result.flags.join(" ")).toContain("incomplete");
    expect(result.audit?.workflowReview?.optionalQuestions).toHaveLength(1);
  });

  test("historical audits remain readable without invented process records", () => {
    const historical = {
      experience: [
        {
          entryIndex: 0,
          company: "ExampleCo",
          bullets: [{ original, tailored: "Developed Python scripts for reports." }],
        },
      ],
    };
    const parsed = variantDetailSchema.shape.rewrites.parse(historical);
    expect(parsed?.workflowReview).toBeUndefined();
  });
});
