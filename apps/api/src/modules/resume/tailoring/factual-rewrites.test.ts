import { EMPTY_RESUME_DATA } from "@openapply/contracts/resume";
import { buildTailoredVariant } from "./build-variant";
import { grounding, workflowReview } from "./fakes";
import { expect, test } from "bun:test";

const original = "Built Python scripts for reports.";
const base = {
  ...EMPTY_RESUME_DATA,
  basics: { name: "Example" },
  experience: [{ company: "Example", title: "Intern", start: "2024", bullets: [original] }],
  skills: [{ group: "Tools", items: ["Kubernetes"] }],
};

for (const tailored of [
  "Led Kubernetes migrations for clients.",
  "Built Python systems for hospitals.",
  "Built Python scripts for hospital reports.",
  "Built scripts for reports.",
]) {
  test(`rejects invented or dropped factual wording: ${tailored}`, () => {
    expect(() =>
      buildTailoredVariant(base, {
        label: "Test",
        workflowReview: workflowReview(),
        bulletRewrites: [
          {
            entryIndex: 0,
            bullets: [
              { original, tailored, grounding: grounding("/experience/0/bullets/0", original) },
            ],
          },
        ],
      }),
    ).toThrow("Tailor validation failed");
  });
}

test("permits moving source words and a bounded leading-verb equivalent", () => {
  const result = buildTailoredVariant(base, {
    label: "Test",
    workflowReview: workflowReview(),
    bulletRewrites: [
      {
        entryIndex: 0,
        bullets: [
          {
            original,
            tailored: "Developed scripts in Python for reports.",
            grounding: grounding("/experience/0/bullets/0", original),
          },
        ],
      },
    ],
  });
  expect(result.content.experience[0].bullets).toEqual([
    "Developed scripts in Python for reports.",
  ]);
});

test("accepts a source-backed Reached result opener without treating it as technology", () => {
  const original = "Built a Discord bot reaching 6,500+ servers with a TypeScript backend.";
  const source = {
    ...EMPTY_RESUME_DATA,
    projects: [{ name: "News bot", keywords: [], bullets: [original] }],
  };
  const rewrite = (tailored: string) =>
    buildTailoredVariant(source, {
      label: "Preview",
      workflowReview: workflowReview(),
      projectBulletRewrites: [
        {
          entryIndex: 0,
          bullets: [
            { original, tailored, grounding: grounding("/projects/0/bullets/0", original) },
          ],
        },
      ],
    });
  const tailored = "Reached 6,500+ servers by building a Discord bot with a TypeScript backend.";
  expect(rewrite(tailored).content.projects[0].bullets).toEqual([tailored]);
  expect(() => rewrite(tailored.replace("6,500+", "65,000+"))).toThrow("Tailor validation failed");
  expect(() => rewrite(tailored.replace("TypeScript", "TypeScript and Kubernetes"))).toThrow(
    "Tailor validation failed",
  );
});

test("recognizes ordinary technical action verbs while retaining named technology checks", () => {
  for (const tailored of [
    "Exposed report output from Python scripts.",
    "Separated reporting steps into Python scripts.",
    "Handled report preparation with Python scripts.",
  ]) {
    const sourceBullet = tailored[0].toLowerCase() + tailored.slice(1);
    const source = { ...base, experience: [{ ...base.experience[0], bullets: [sourceBullet] }] };
    const request = {
      label: "Action verbs",
      workflowReview: workflowReview(),
      bulletRewrites: [
        {
          entryIndex: 0,
          bullets: [
            {
              original: sourceBullet,
              tailored,
              grounding: grounding("/experience/0/bullets/0", sourceBullet),
            },
          ],
        },
      ],
    };
    expect(buildTailoredVariant(source, request).content.experience[0].bullets).toEqual([tailored]);
    request.bulletRewrites[0].bullets[0].tailored = tailored.replace(
      "Python",
      "Python and InventedCloud",
    );
    expect(() => buildTailoredVariant(source, request)).toThrow("Tailor validation failed");
  }
});
