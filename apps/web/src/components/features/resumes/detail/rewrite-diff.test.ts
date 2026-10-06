import { EMPTY_RESUME_DATA } from "@openapply/contracts/resume";
import { diffRewrite } from "./rewrite-diff";
import { expect, test } from "bun:test";

test("review reveals changed identity, graduation dates, headline and project descriptions", () => {
  const base = structuredClone(EMPTY_RESUME_DATA);
  base.basics = { name: "Applicant", headline: "Engineer", email: "a@example.test" };
  base.education = [{ school: "College", degree: "BSc", end: "2026", details: [] }];
  base.projects = [{ name: "App", description: "Original", bullets: [], keywords: [] }];
  const rewritten = structuredClone(base);
  rewritten.basics.headline = "Software Engineer";
  rewritten.basics.email = "b@example.test";
  rewritten.education[0]!.end = "2027";
  rewritten.projects[0]!.description = "Changed";
  expect(diffRewrite(base, rewritten).map((item) => item.where)).toEqual([
    "Basics · Headline",
    "Basics · Email",
    "Projects · 1 · Description",
    "Education · 1 · End",
  ]);
});
test("review exposes removed entries and added skills without mutating either version", () => {
  const base = structuredClone(EMPTY_RESUME_DATA);
  base.experience = [
    { company: "Original employer", title: "Intern", start: "2025", bullets: ["Built an API."] },
  ];
  const rewritten = structuredClone(base);
  rewritten.experience = [];
  rewritten.skills = [{ group: "Languages", items: ["Invented skill"] }];
  const changes = diffRewrite(base, rewritten);
  expect(changes).toContainEqual({
    where: "Experience · 1 · Company",
    before: "Original employer",
    after: "",
  });
  expect(changes).toContainEqual({
    where: "Skills · 1 · Items · 1",
    before: "",
    after: "Invented skill",
  });
  expect(base.experience).toHaveLength(1);
  expect(diffRewrite(base, structuredClone(base))).toEqual([]);
});
