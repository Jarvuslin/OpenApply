import { applicationOutcomes } from "./analytics.outcomes";
import { describe, expect, it } from "bun:test";

describe("application outcomes", () => {
  it("splits applications by whether they ever reached an interview", () => {
    const rows = [
      { id: "a", status: "applied" as const },
      { id: "b", status: "rejected" as const },
      { id: "c", status: "rejected" as const },
      { id: "d", status: "offer" as const },
      { id: "e", status: "interviewing" as const },
      { id: "f", status: "withdrawn" as const },
    ];
    // "c" was rejected after an interview, so it counts under interviews as no offer.
    expect(applicationOutcomes(rows, new Set(["c", "d"]))).toEqual({
      total: 6,
      rejected: 1,
      noAnswer: 1,
      withdrawn: 1,
      interviews: 3,
      offers: 1,
      noOffer: 1,
      withdrewAfterInterview: 0,
      interviewing: 1,
    });
  });
});
