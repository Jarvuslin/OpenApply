import { resumeDataSchema } from "@openapply/contracts/resume";
import type { CreateResumeEvidence } from "@openapply/contracts/resume-evidence";
import {
  githubLogin,
  validateEvidenceReview,
  validateGithubContribution,
  validateScopedSource,
} from "./source-validation";
import { describe, expect, it } from "bun:test";

const source: Extract<CreateResumeEvidence["source"], { kind: "github" }> = {
  kind: "github",
  repository: "applicant/reporting",
  commitSha: "a".repeat(40),
  path: "src/report.ts",
  quote: "const total = summarize(rows);",
  attribution: { kind: "profile_github" },
};
const commit = {
  sha: source.commitSha,
  author: { login: "applicant" },
  files: [
    {
      filename: source.path,
      patch: "@@ -1 +1 @@\n-const total = 0;\n+const total = summarize(rows);",
    },
  ],
};

describe("GitHub evidence attribution", () => {
  it("requires an applicant-authored commit and the exact contributed lines", () => {
    const verification = validateGithubContribution(source, commit, "applicant");
    expect(verification.authorLogin).toBe("applicant");
    expect(verification.sourceUrl).toContain(`/blob/${source.commitSha}/src/report.ts`);
    expect(verification.limitation).toContain("do not prove sole authorship");
  });

  it("does not treat repository ownership, another author's commit or a missing author as proof", () => {
    expect(() =>
      validateGithubContribution(
        source,
        { ...commit, author: { login: "someone-else" } },
        "applicant",
      ),
    ).toThrow("applicant-linked");
    expect(() =>
      validateGithubContribution(source, { ...commit, author: null }, "applicant"),
    ).toThrow("applicant-linked");
  });

  it("rejects quotes from removed/context lines and another file or commit", () => {
    expect(() =>
      validateGithubContribution({ ...source, quote: "const total = 0;" }, commit, "applicant"),
    ).toThrow("added lines");
    expect(() =>
      validateGithubContribution({ ...source, path: "other.ts" }, commit, "applicant"),
    ).toThrow("added lines");
    expect(() =>
      validateGithubContribution(source, { ...commit, sha: "b".repeat(40) }, "applicant"),
    ).toThrow("applicant-linked");
  });

  it("uses profile identities only, never repository URLs or unrelated hosts", () => {
    expect(githubLogin("https://github.com/applicant/")).toBe("applicant");
    expect(githubLogin("https://github.com/applicant/repository")).toBeNull();
    expect(githubLogin("https://github.com.evil.test/applicant")).toBeNull();
  });

  it("keeps personal repository work out of unrelated employer/project entries", () => {
    const content = resumeDataSchema.parse({
      basics: { name: "Applicant" },
      experience: [
        { company: "North", title: "Engineer", start: "2025", bullets: ["Built APIs."] },
      ],
      projects: [{ name: "Reporting", url: "https://github.com/applicant/reporting" }],
    });
    expect(() =>
      validateScopedSource(content, "/experience/0", source.quote, source.repository),
    ).toThrow("does not link");
    expect(() =>
      validateScopedSource(content, "/projects/0", source.quote, "applicant/reporting-other"),
    ).toThrow("does not link");
    expect(() =>
      validateScopedSource(content, "/projects/0", source.quote, source.repository),
    ).not.toThrow();
    expect(() =>
      validateScopedSource(content, "general", source.quote, source.repository),
    ).not.toThrow();
  });
});

describe("Quoted evidence is data", () => {
  it("cannot promote a negated fact or quoted assistant suggestion to personal experience", () => {
    for (const content of [
      "I did not use Python.",
      "The assistant suggested this example: I built Python scripts.",
    ]) {
      expect(() =>
        validateEvidenceReview(
          {
            statement: "Built Python scripts.",
            scope: "general",
            status: "supported",
            source: { kind: "resume", version: 1, path: "/experience/0", quote: content },
            review: {
              claimType: "explicit",
              context: "personal_assertion",
              rationale: "A claimed source statement.",
            },
          },
          content,
        ),
      ).toThrow();
    }
  });
});
