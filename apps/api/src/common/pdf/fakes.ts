import { EMPTY_RESUME_DATA, type ResumeData } from "@openapply/contracts/resume";

export function syntheticResume(): ResumeData {
  return {
    ...EMPTY_RESUME_DATA,
    basics: {
      name: "Synthetic Applicant",
      email: "example@example.com",
      github: "https://github.com/example",
      phone: "555-0100",
    },
    summary: "Structured outputs in C# & Python reduced costs by 15% with $5 tests.",
    education: [
      {
        school: "Example University",
        degree: "Computing",
        details: ["Honours"],
        location: "Toronto",
        start: "2020",
        end: "2024",
        bullets: ["Coursework: algorithms and data structures."],
      },
    ],
    experience: [
      {
        company: "Example Employer",
        title: "Engineer",
        location: "Toronto",
        start: "2024",
        end: "2025",
        dateNote: "Contract",
        bullets: ["Built structured outputs with Python and tested 36 cases."],
      },
    ],
    projects: [
      {
        name: "Example project",
        start: "2023",
        end: "2024",
        keywords: ["TypeScript"],
        bullets: ["Built an example using source_data and a documented API."],
      },
    ],
    skills: [{ group: "Languages", items: ["C#", "Python", "TypeScript"] }],
    certifications: [
      {
        name: "Example Certificate",
        issuer: "Example Issuer",
        issued: "2022",
        url: "https://example.com/certification",
      },
    ],
    sections: [
      {
        title: "Community",
        entries: [
          {
            heading: "Example Volunteering",
            meta: "2021",
            bullets: ["Helped people with technical documentation."],
          },
        ],
      },
    ],
  };
}
