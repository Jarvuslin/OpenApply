import { canadianInternships } from "./public-feeds-canada";
import { expect, it } from "bun:test";

const badge = "[![Apply](https://img.shields.io/badge/-Apply-blue?style=for-the-badge)]";
const README = `# 🍁 Canadian Tech Internships - 2027

| Company | Role | Location | Apply | Date Posted |
|--------|------|----------|:-----:|--------------|
| Magnet Forensics | Software Developer Co-op (Winter 2027) | Waterloo, ON / Ottawa, ON | ${badge}(https://jobs.lever.co/magnetforensics/6eba87dc/apply) | Oct 10, 2026 |
| ↳ | Data Analyst (Winter 2027) | Toronto, ON | ${badge}(https://jobs.lever.co/magnetforensics/7fcb98ed/) | Oct 9, 2026 | 
| Motorola | Software Developer Co-op | Vancouver, BC | Closed🔒 | Oct 7, 2026 |
| ↳ | Firmware Intern | Vancouver, BC | ${badge}(https://www.linkedin.com/jobs/view/123) | Oct 6, 2026 |
`;

it("reads open rows, carries the company down, and skips closed or blocked links", async () => {
  const jobs = await canadianInternships(async (url) => {
    expect(url).toBe(
      "https://raw.githubusercontent.com/negarprh/Canadian-Tech-Internships-2027/main/README.md",
    );
    return README;
  });
  expect(jobs).toEqual([
    {
      title: "Software Developer Co-op (Winter 2027)",
      company: "Magnet Forensics",
      location: "Waterloo, ON; Ottawa, ON",
      url: "https://jobs.lever.co/magnetforensics/6eba87dc/apply",
      identityUrl: "https://jobs.lever.co/magnetforensics/6eba87dc",
      attributionUrl: "https://github.com/negarprh/Canadian-Tech-Internships-2027",
      description: "",
      postedAt: new Date("2026-10-10T00:00:00.000Z"),
      level: "intern",
    },
    expect.objectContaining({
      title: "Data Analyst (Winter 2027)",
      company: "Magnet Forensics",
      level: "intern",
      postedAt: new Date("2026-10-09T00:00:00.000Z"),
    }),
  ]);
});
