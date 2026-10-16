import { fitAssessmentSchema, scoreAssessmentInputSchema } from "@openapply/contracts/scoring";
import { assessFit } from "./assessment";
import { scoringContext, scoringInput } from "./fakes";
import { describe, expect, it } from "bun:test";

describe("original-resume semantic assessment", () => {
  it("scores requirements and responsibilities separately without awarding preference points", () => {
    const context = scoringContext();
    const input = scoringInput(context);
    input.assessments.find((item) => item.category === "responsibility")!.rating = "partial";
    const result = assessFit(context, input);
    expect(result.score).toBe(80);
    expect(result.components.requirements).toEqual({ score: 100, count: 1, weight: 0.6 });
    expect(result.components.responsibilities).toEqual({ score: 50, count: 1, weight: 0.4 });
    expect(result.roleMatch.relevance).toBe("matched");
    expect(result.verdict).toBe("assessed");
    expect(fitAssessmentSchema.parse(result)).toEqual(result);
  });

  it("gives no self-overlap points when the resume supports none of the JD criteria", () => {
    const context = scoringContext();
    const input = scoringInput(context);
    for (const item of input.assessments)
      if (item.category !== "context") {
        item.rating = "unsupported";
        item.evidence = [];
      }
    const result = assessFit(context, input);
    expect(result.score).toBe(0);
    expect(result.gaps).toHaveLength(2);
    expect(result.confidenceMeaning).toContain("not a probability");
  });

  it("requires complete, unique and known criterion IDs", () => {
    for (const change of ["missing", "duplicate", "unknown"]) {
      const input = scoringInput();
      if (change === "missing") input.assessments.pop();
      if (change === "duplicate") input.assessments[1] = input.assessments[0];
      if (change === "unknown") input.assessments[1].criterionId = "fabricated";
      expect(() => assessFit(scoringContext(), input)).toThrow("exactly once");
    }
  });

  it("rejects nonexistent, altered and incorrectly positioned original-resume quotations", () => {
    for (const change of ["text", "offset", "empty", "absent"]) {
      const input = scoringInput();
      const criterion = input.assessments.find((item) => item.category === "requirement")!;
      if (change === "text")
        criterion.evidence[0].quote = "Expert in everything the employer wants.";
      if (change === "offset") criterion.evidence[0].start++;
      if (change === "empty") criterion.evidence[0].end = criterion.evidence[0].start;
      if (change === "absent") criterion.evidence = [];
      expect(() => assessFit(scoringContext(), input)).toThrow();
    }
  });

  it("requires evidence for partial and contradicted judgments too", () => {
    for (const rating of ["partial", "contradicted"] as const) {
      const input = scoringInput();
      const criterion = input.assessments.find((item) => item.category === "requirement")!;
      criterion.rating = rating;
      criterion.evidence = [];
      expect(() => assessFit(scoringContext(), input)).toThrow("requires original-resume evidence");
    }
  });

  it("rejects heading points, unexplained exclusions and all-context assessments", () => {
    const context = scoringContext();
    const heading = scoringInput(context);
    heading.assessments[0].category = "requirement";
    expect(() => assessFit(context, heading)).toThrow("Heading");
    const unexplained = scoringInput(context);
    unexplained.assessments[0].explanation = " ";
    expect(() => assessFit(context, unexplained)).toThrow("explanation");
    const empty = scoringInput(context);
    for (const item of empty.assessments) {
      item.category = "context";
      item.rating = "not_applicable";
    }
    expect(() => assessFit(context, empty)).toThrow("all-context");
  });

  it("flags missing categories and uncertainty for agent review without inventing confidence", () => {
    const input = scoringInput();
    const item = input.assessments.find((a) => a.category === "responsibility")!;
    item.rating = "uncertain";
    item.evidence = [];
    const result = assessFit(scoringContext(), input);
    expect(result.verdict).toBe("needs_review");
    expect(result.confidence).toBe(0.5);
    item.category = "context";
    item.rating = "not_applicable";
    expect(assessFit(scoringContext(), input).verdict).toBe("needs_review");
  });

  it("grounds role judgments in the saved JD and applies a small explicit family hierarchy", () => {
    const context = scoringContext();
    for (const family of ["Frontend", "Backend", "Full stack", "Mobile"] as const) {
      const input = scoringInput(context);
      input.roleMatch.family = family;
      expect(assessFit(context, input).roleMatch.relevance).toBe("matched");
    }
    for (const family of [
      "Data engineering",
      "DevOps / platform",
      "QA / test",
      "Security",
      "Other",
    ] as const) {
      const input = scoringInput(context);
      input.roleMatch.family = family;
      const result = assessFit(context, input);
      expect(result.roleMatch.relevance).toBe("outside_preferences");
      expect(result.score).toBe(100);
    }
    const unclear = scoringInput(context);
    unclear.roleMatch.family = "Unclear";
    expect(assessFit(context, unclear).roleMatch.relevance).toBe("unclear");
    context.preferences.jobPreferences.roles = [];
    expect(assessFit(context, unclear).roleMatch.relevance).toBe("not_restricted");
    unclear.roleMatch.evidence[0].quote = "Invented role title";
    expect(() => assessFit(context, unclear)).toThrow("Role evidence");
  });

  it("rejects stale input hashes and legacy caller-provided skills, digest or score", () => {
    const input = scoringInput();
    input.basis = { ...input.basis, sourceSha256: "0".repeat(64) };
    expect(() => assessFit(scoringContext(), input)).toThrow("inputs changed");
    for (const extra of [
      { profile: { skills: ["invented"] } },
      { digest: {} },
      { score: 100 },
      { minScore: 0 },
    ]) {
      expect(scoreAssessmentInputSchema.safeParse({ ...scoringInput(), ...extra }).success).toBe(
        false,
      );
    }
  });
});
