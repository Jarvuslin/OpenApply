import { matchesArtifactAudit } from "./artifact-audit-match";
import { describe, expect, it } from "bun:test";

describe("wording audit revision identity", () => {
  it("compares all fields independently of JSON object key order", () => {
    expect(
      matchesArtifactAudit(
        { experience: [], workflowReview: { status: "unavailable" } },
        {
          workflowReview: { status: "unavailable" },
          experience: [],
        },
      ),
    ).toBe(true);
  });
  it("rejects changed wording, changed evidence and omitted workflow records", () => {
    const saved = {
      experience: [{ original: "Source", tailored: "Saved", evidence: "source-1" }],
      workflowReview: { status: "unavailable" },
    };
    expect(
      matchesArtifactAudit(saved, {
        ...saved,
        experience: [{ original: "Source", tailored: "New", evidence: "source-1" }],
      }),
    ).toBe(false);
    expect(
      matchesArtifactAudit(saved, {
        ...saved,
        experience: [{ original: "Source", tailored: "Saved", evidence: "source-2" }],
      }),
    ).toBe(false);
    expect(matchesArtifactAudit(saved, { experience: saved.experience })).toBe(false);
  });
  it("keeps missing or reordered audits from looking like the saved revision", () => {
    expect(matchesArtifactAudit(undefined, undefined)).toBe(false);
    expect(matchesArtifactAudit(null, { experience: [] })).toBe(false);
    expect(matchesArtifactAudit(["a", "b"], ["b", "a"])).toBe(false);
    expect(matchesArtifactAudit(null, null)).toBe(true);
  });
});
