import { EMPTY_RESUME_DATA, type ResumeData } from "@openapply/contracts/resume";
import {
  type RewriteGrounding,
  type TailorVariantBody,
  tailorResumeSchema,
  variantDetailSchema,
} from "../variants/variant.schema";
import { buildTailoredVariant } from "./build-variant";
import { grounding, workflowReview } from "./fakes";
import { describe, expect, it } from "bun:test";

const original =
  "Built Python scripts that reduced weekly report preparation time by 40% for 1,200 records.";
const sourceClause = "Used SQL to query report data.";
const projectBullet = "Built a React dashboard to compare model responses.";
const jd = "Build AI evaluation tools and automate data workflows using Python.";

function base(): ResumeData {
  return {
    ...EMPTY_RESUME_DATA,
    basics: { name: "Sample Applicant", headline: "Software Engineer" },
    experience: [
      {
        company: "OriginalCo",
        title: "Intern",
        start: "May 2024",
        end: "Aug 2024",
        dateNote: "Multiple engagements",
        bullets: [original, sourceClause],
      },
      {
        company: "OtherCo",
        title: "Developer",
        start: "2023",
        bullets: ["Deployed Kubernetes services for customers."],
      },
    ],
    projects: [
      { name: "Model Evaluator", start: "2024", bullets: [projectBullet], keywords: ["React"] },
    ],
    skills: [{ group: "Tools", items: ["Python", "Kubernetes", "Docker"] }],
    education: [
      {
        school: "Example University",
        degree: "BSc",
        location: "Kingston, Ontario",
        details: [],
        bullets: ["Coursework: algorithms"],
      },
    ],
  };
}

function rewrite(
  tailored: string,
  review = grounding("/experience/0/bullets/0", original),
): TailorVariantBody {
  return {
    label: "Preview",
    workflowReview: workflowReview(),
    bulletRewrites: [{ entryIndex: 0, bullets: [{ original, tailored, grounding: review }] }],
  };
}

describe("source-grounded tailoring", () => {
  it("accepts outcome-first XYZ wording and retains identities, dates and the immutable base", () => {
    const source = base();
    const before = structuredClone(source);
    const tailored =
      "Reduced weekly report preparation time by 40% across 1,200 records by automating reports with Python scripts.";
    const review = grounding("/experience/0/bullets/0", original);
    review.target = {
      kind: "job_description",
      quote: "automate data workflows using Python",
      reason: "Surface the supported automation outcome.",
    };
    const result = buildTailoredVariant(source, {
      ...rewrite(tailored, review),
      jobDescription: jd,
    });
    expect(result.content.experience[0]).toEqual({
      ...source.experience[0],
      bullets: [tailored, sourceClause],
    });
    expect(result.audit?.experience[0].bullets[0].grounding).toEqual(review);
    expect(result.content.education).toEqual(source.education);
    expect(source).toEqual(before);
  });

  it("supports additional source-grounded context from the same employment", () => {
    const review = grounding("/experience/0/bullets/0", original);
    review.evidence.push({ path: "/experience/0/bullets/1", quote: sourceClause });
    const result = buildTailoredVariant(
      base(),
      rewrite(
        "Reduced weekly report preparation time by 40% for 1,200 records using Python scripts and SQL report queries.",
        review,
      ),
    );
    expect(result.rewordedBullets).toBe(1);
    expect(result.audit?.experience[0].bullets[0].grounding?.evidence).toHaveLength(2);
  });

  it("does not transfer an existing measurement to another outcome mentioned in the same employment", () => {
    const source = base();
    source.experience[0].bullets.push("Prepared cost reports.");
    const review = grounding("/experience/0/bullets/0", original);
    review.evidence.push({ path: "/experience/0/bullets/2", quote: "Prepared cost reports." });
    expect(() =>
      buildTailoredVariant(
        source,
        rewrite(original.replace("report preparation time", "cost"), review),
      ),
    ).toThrow("Tailor validation failed");
  });

  it("rewrites and audits projects without moving project facts into work experience", () => {
    const review = grounding("/projects/0/bullets/0", projectBullet);
    const tailored = "Developed a React interface for comparing model responses.";
    const result = buildTailoredVariant(base(), {
      label: "Preview",
      workflowReview: workflowReview(),
      projectBulletRewrites: [
        { entryIndex: 0, bullets: [{ original: projectBullet, tailored, grounding: review }] },
      ],
    });
    expect(result.content.projects[0].bullets).toEqual([tailored]);
    expect(result.audit?.projects).toEqual([
      {
        entryIndex: 0,
        name: "Model Evaluator",
        bullets: [{ original: projectBullet, tailored, grounding: review }],
      },
    ]);
    expect(result.content.experience).toEqual(base().experience);
  });

  for (const tailored of [
    original.replace("40%", "45%"),
    original.replace("40%", "40"),
    original.replace("1,200", "1.200"),
    original.replace("1,200", "12,000"),
    original.replace("Python", "Docker"),
    original.replace("Python", "python and kubernetes"),
    original.replace("Python", "Python for Google"),
    original.replace("Built", "Led development of"),
    original.replace("report preparation time", "cost"),
    original.replace("report preparation time", "revenue"),
  ]) {
    it(`rejects altered quantities, tools, identities or claims: ${tailored}`, () => {
      expect(() => buildTailoredVariant(base(), rewrite(tailored))).toThrow(
        "Tailor validation failed",
      );
    });
  }

  it("permits equivalent comma and percent spellings without changing the measurement", () => {
    expect(
      buildTailoredVariant(
        base(),
        rewrite(original.replace("40%", "40 percent").replace("1,200", "1200")),
      ).rewordedBullets,
    ).toBe(1);
  });

  it("rejects source evidence from another employment even when the tool is on the base", () => {
    const review = grounding("/experience/0/bullets/0", original);
    review.evidence.push({
      path: "/experience/1/bullets/0",
      quote: base().experience[1].bullets[0],
    });
    expect(() =>
      buildTailoredVariant(
        base(),
        rewrite(original.replace("Python", "Python and Kubernetes"), review),
      ),
    ).toThrow("Tailor validation failed");
  });

  it("requires the full original bullet as an anchor, valid source quotations, and an actual JD target", () => {
    const valid = grounding("/experience/0/bullets/0", original);
    const invalid: RewriteGrounding[] = [
      { ...valid, evidence: [{ path: "/experience/0/bullets/0", quote: "Python" }] },
      { ...valid, evidence: [{ path: "/experience/0/bullets/0", quote: "Fabricated quote" }] },
      { ...valid, evidence: [{ path: "/experience/999/bullets/0", quote: original }] },
      {
        ...valid,
        target: { ...valid.target, kind: "job_description", quote: "Lead enterprise deployments" },
      },
    ];
    for (const review of invalid) {
      expect(() =>
        buildTailoredVariant(base(), { ...rewrite(original, review), jobDescription: jd }),
      ).toThrow("Tailor validation failed");
    }
  });

  it("requires a supported factual review at the request boundary", () => {
    const request = rewrite(original);
    const pair = request.bulletRewrites?.[0].bullets[0];
    expect(
      tailorResumeSchema.safeParse({
        ...request,
        bulletRewrites: [{ entryIndex: 0, bullets: [{ original, tailored: original }] }],
      }).success,
    ).toBe(false);
    expect(
      tailorResumeSchema.safeParse({
        ...request,
        bulletRewrites: [
          {
            entryIndex: 0,
            bullets: [
              { ...pair, grounding: { ...pair?.grounding, review: { verdict: "unchecked" } } },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate groups rather than applying an ambiguous second edit", () => {
    const request = rewrite(original);
    request.bulletRewrites?.push(request.bulletRewrites[0]);
    expect(() => buildTailoredVariant(base(), request)).toThrow("Tailor validation failed");
  });

  it("audits a newly created grounded summary and keeps its empty original representable", () => {
    const result = buildTailoredVariant(base(), {
      label: "Preview",
      workflowReview: workflowReview(),
      summary: "Software engineer who automated report preparation with Python.",
      summaryGrounding: grounding("/experience/0/bullets/0", original),
    });
    expect(result.audit?.summary?.original).toBe("");
    expect(variantDetailSchema.shape.rewrites.safeParse(result.audit).success).toBe(true);
    expect(result.audit?.reviewMeaning).toContain("not proof");
  });

  it("does not borrow uncited skills or invent seniority or a summary metric", () => {
    for (const summary of [
      "Engineer deploying kubernetes.",
      "Senior software engineer using Python.",
      "Engineer who improved reports by 80% using Python.",
    ]) {
      expect(() =>
        buildTailoredVariant(base(), {
          label: "Preview",
          workflowReview: workflowReview(),
          summary,
          summaryGrounding: grounding("/experience/0/bullets/0", original),
        }),
      ).toThrow("Tailor validation failed");
    }
  });

  it("keeps every bullet by default and records every omission from an explicit cap", () => {
    const source = base();
    source.experience[0].bullets.push(
      "Maintained reports.",
      "Tested scripts.",
      "Documented report steps.",
    );
    const retained = buildTailoredVariant(source, {
      label: "Preview",
      workflowReview: workflowReview(),
      jobKeywords: ["Python"],
    });
    expect(retained.content.experience[0].bullets).toHaveLength(5);
    expect(retained.audit).toBeNull();
    const capped = buildTailoredVariant(source, {
      label: "Preview",
      workflowReview: workflowReview(),
      jobKeywords: ["Python"],
      maxBulletsPerEntry: 1,
    });
    expect(capped.content.experience[0].bullets).toEqual([original]);
    expect(capped.audit?.omissions?.map((item) => item.original)).toEqual(
      source.experience[0].bullets.slice(1),
    );
  });
});
