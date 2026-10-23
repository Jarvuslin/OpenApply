import { EMPTY_RESUME_DATA } from "@openapply/contracts/resume";
import { buildResumeTex } from "./canonical-template";
import { describe, expect, it } from "bun:test";

describe("canonical resume template", () => {
  it("escapes applicant text and retains all factual sections in the approved order", () => {
    const result = buildResumeTex({
      ...EMPTY_RESUME_DATA,
      basics: { name: "Example & Applicant", email: "example@example.com" },
      summary: "Uses C# and saves 15% with $5 costs; \\input{private} stays text.",
      education: [
        { school: "School", degree: "Degree", details: ["Honours"], bullets: ["Coursework"] },
      ],
      experience: [
        { company: "Employer", title: "Engineer", start: "2020", bullets: ["Built things."] },
      ],
      projects: [{ name: "Project", bullets: ["Tested things."], keywords: ["C++"] }],
      skills: [{ group: "Tools", items: ["C#", "Python"] }],
      certifications: [{ name: "Certificate", issued: "2021" }],
      sections: [
        { title: "Community", entries: [{ heading: "Volunteer", bullets: ["Helped people."] }] },
      ],
    });
    expect(result.tex).toContain("Example \\& Applicant");
    expect(result.tex).toContain("15\\%");
    expect(result.tex).toContain("\\textbackslash}input\\{private\\}");
    expect(result.tex).not.toContain("\\input{private}");
    const headings = [
      "Education",
      "Experience",
      "Projects",
      "Technical Skills",
      "Certifications",
      "Community",
    ];
    const positions = headings.map((heading) => result.tex.indexOf(`\\section{${heading}}`));
    expect(positions.every((position) => position > 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(result.expectedText).toContain("Coursework");
    expect(result.tex).toContain("\\resumeSubheading{School}{}{Degree}{}");
    expect(result.tex).toContain("\\resumeItem{Honours}");
    expect(result.expectedText).toContain("Helped people.");
    expect(result.tex).toContain("\\documentclass[letterpaper,11pt]{article}");
    expect(result.tex).toContain("\\addtolength{\\textwidth}{1in}");
    expect(result.tex).not.toContain("Present");
  });

  it("omits empty sections and rejects active-link protocols", () => {
    const empty = buildResumeTex({ ...EMPTY_RESUME_DATA, basics: { name: "Applicant" } });
    expect(empty.tex).not.toContain("\\section{");
    expect(() =>
      buildResumeTex({
        ...EMPTY_RESUME_DATA,
        basics: { name: "Applicant", website: "javascript:alert(1)" },
      }),
    ).toThrow("HTTP");
  });
});
