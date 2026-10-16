import { optionalPhoneSchema } from "./phone";
import { resumeDataSchema } from "./resume";
import { expect, it } from "bun:test";

it("preserves local resume phone formatting while applicant phones remain validated", () => {
  const result = resumeDataSchema.parse({
    basics: { name: "Example Applicant", phone: "437-555-0123" },
  });
  expect(result.basics.phone).toBe("437-555-0123");
  expect(optionalPhoneSchema.safeParse("437-555-0123").success).toBe(false);
});

it("retains source education location, coursework and employment date annotations", () => {
  const content = resumeDataSchema.parse({
    basics: { name: "Example Applicant" },
    experience: [
      {
        company: "Example",
        title: "Developer",
        start: "2024",
        dateNote: "Multiple engagements",
        bullets: [],
      },
    ],
    education: [
      {
        school: "University",
        degree: "BSc",
        location: "Kingston, Ontario",
        bullets: ["Coursework: algorithms"],
      },
    ],
  });
  expect(content.experience[0].dateNote).toBe("Multiple engagements");
  expect(content.education[0]).toMatchObject({
    location: "Kingston, Ontario",
    bullets: ["Coursework: algorithms"],
  });
  const older = resumeDataSchema.parse({
    basics: { name: "Example" },
    experience: [{ company: "Example", title: "Intern", start: "2023", bullets: [] }],
    education: [{ school: "University", degree: "BSc" }],
  });
  expect(older.experience[0].dateNote).toBeUndefined();
  expect(older.education[0].location).toBeUndefined();
  expect(older.education[0].bullets).toBeUndefined();
});
