import { scoringContext } from "@/modules/scoring/fakes";
import { evaluateEligibility } from "./evaluation.eligibility";
import { describe, expect, it } from "bun:test";

describe("exact-span conservative evaluation eligibility", () => {
  function context(description: string, location: string | null = "Toronto, Canada") {
    const row = scoringContext();
    row.job.description = description;
    row.job.location = location;
    return row;
  }
  it("does not treat profile authorization defaults as human-confirmed eligibility", () => {
    const row = context("No visa sponsorship available in Canada.");
    row.preferences.workAuthorization = [
      { country: "Canada", authorized: false, sponsorship: true },
    ];
    const value = evaluateEligibility(row, null);
    expect(value.outcome).toBe("needs_review");
    expect(value.facts).toBeNull();
    expect(value.restrictions[0].outcome).toBe("unknown");
  });
  it("keeps sponsorship independent from authorization and quotes original Unicode spacing exactly", () => {
    const row = context(
      "Canada applicants:\nMust be authorized to work in Canada.\nNo  visa sponsorship available.",
    );
    const value = evaluateEligibility(row, {
      countryCode: "CA",
      confirmed: true,
      authorized: true,
      requiresSponsorship: true,
    });
    expect(value.outcome).toBe("ineligible");
    expect(value.restrictions.find((item) => item.kind === "authorization")?.outcome).toBe("met");
    expect(value.restrictions.find((item) => item.kind === "sponsorship")?.outcome).toBe("not_met");
    for (const span of value.restrictions)
      expect(row.job[span.source].slice(span.start, span.end)).toBe(span.quote);
    expect(value.restrictions.find((item) => item.kind === "sponsorship")?.quote).toBe(
      "No  visa sponsorship",
    );
  });
  it("requires the exact confirmed job-country context and leaves missing facts unresolved", () => {
    const row = context("No visa sponsorship available in Canada.");
    expect(
      evaluateEligibility(row, { countryCode: "US", confirmed: true, requiresSponsorship: true })
        .outcome,
    ).toBe("needs_review");
    expect(
      evaluateEligibility(row, { countryCode: "CA", confirmed: true, authorized: true }).outcome,
    ).toBe("needs_review");
    expect(
      evaluateEligibility(context("No visa sponsorship.", "Remote"), {
        countryCode: "CA",
        confirmed: true,
        requiresSponsorship: true,
      }).outcome,
    ).toBe("needs_review");
    expect(
      evaluateEligibility(row, { countryCode: "CA", confirmed: true, requiresSponsorship: false })
        .outcome,
    ).toBe("eligible");
    expect(() => evaluateEligibility(row, { countryCode: "ZZ", confirmed: true })).toThrow("ISO");
  });
  it("ignores stated absence of a sponsorship restriction and never invents eligibility from silence", () => {
    for (const text of [
      "No visa sponsorship restrictions apply in Canada.",
      "This posting does not state no visa sponsorship.",
      "We support developers in Canada.",
    ])
      expect(evaluateEligibility(context(text), null)).toEqual({
        outcome: "no_known_restriction",
        facts: null,
        restrictions: [],
      });
  });
  it("needs confirmed citizenship and clearance facts instead of treating resume absence as a conflict", () => {
    const row = context(
      "US citizenship required.\nActive security clearance is required.",
      "United States",
    );
    expect(evaluateEligibility(row, null).outcome).toBe("needs_review");
    const result = evaluateEligibility(row, {
      countryCode: "US",
      confirmed: true,
      citizen: false,
      activeClearance: true,
    });
    expect(result.outcome).toBe("ineligible");
    expect(result.restrictions.find((item) => item.kind === "clearance")?.outcome).toBe("met");
  });
  it("does not replace ambiguous multi-country scope with the job location", () => {
    const row = context("No visa sponsorship for Canada or the United States.", "Toronto, Canada");
    const result = evaluateEligibility(row, {
      countryCode: "CA",
      confirmed: true,
      requiresSponsorship: true,
    });
    expect(result.outcome).toBe("needs_review");
    expect(result.restrictions[0].countryCode).toBeNull();
    expect(
      evaluateEligibility(context("Must be authorized to work in the U.S.", "United States"), {
        countryCode: "US",
        confirmed: true,
        authorized: false,
      }).outcome,
    ).toBe("ineligible");
  });
  it("retains conditional restrictions for review and binds an explicit country to its own clause", () => {
    const conditional = evaluateEligibility(
      context("If you apply, you must be authorized to work in Canada."),
      { countryCode: "CA", confirmed: true, authorized: false },
    );
    expect(conditional.outcome).toBe("needs_review");
    expect(conditional.restrictions).toHaveLength(1);
    const opposite = evaluateEligibility(
      context("Must be authorized to work in the United States; work with Canada teams."),
      { countryCode: "CA", confirmed: true, authorized: true },
    );
    expect(opposite.outcome).toBe("needs_review");
    expect(opposite.restrictions[0].countryCode).toBe("US");
    expect(
      evaluateEligibility(
        context("Applicants are not required to be authorized to work in Canada."),
        { countryCode: "CA", confirmed: true, authorized: false },
      ).outcome,
    ).toBe("no_known_restriction");
  });
});
