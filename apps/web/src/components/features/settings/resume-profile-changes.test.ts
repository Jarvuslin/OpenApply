import { USER_DEFAULT_VALUES } from "@openapply/contracts/user";
import { resumeHistoryAdditions, resumeProfileChanges } from "./resume-profile-changes";
import { expect, test } from "bun:test";

test("profile import previews normalized fields without mutating the draft", () => {
  const profile = structuredClone(USER_DEFAULT_VALUES);
  const before = structuredClone(profile);
  const changes = resumeProfileChanges(profile, {
    name: "Morgan Example",
    email: "morgan@example.com",
    phone: "(416) 555-2671",
    location: "Toronto, Ontario, Canada",
    github: "github.com/morgan",
  });
  expect(profile).toEqual(before);
  expect(Object.fromEntries(changes.map(({ field, value }) => [field, value]))).toEqual({
    firstName: "Morgan",
    lastName: "Example",
    contactEmail: "morgan@example.com",
    country: "Canada",
    phone: "+14165552671",
    github: "https://github.com/morgan",
    city: "Toronto",
    state: "Ontario",
  });
});

test("confirmed fields and eligibility, preferences, primary resume stay outside the import", () => {
  const profile = {
    ...structuredClone(USER_DEFAULT_VALUES),
    firstName: "Confirmed",
    lastName: "Name",
    contactEmail: "confirmed@example.com",
    phone: "+14165552672",
    country: "Canada",
    city: "Toronto",
    state: "Ontario",
    requiresSponsorship: true,
    workAuthorization: [{ country: "Canada", authorized: true, sponsorship: true }],
    primaryResumeId: "11111111-1111-4111-8111-111111111111",
    preferredLocations: ["Toronto"],
  };
  const before = structuredClone(profile);
  const changes = resumeProfileChanges(profile, {
    name: "Different Person",
    email: "different@example.com",
    phone: "+12025550123",
    location: "Seattle, Washington, United States",
    headline: "Senior engineer seeking relocation",
  });
  expect(changes).toEqual([]);
  expect(profile).toEqual(before);
});

test("preview excludes a field filled manually after a prior preview", () => {
  const profile = { ...USER_DEFAULT_VALUES, firstName: " ", contactEmail: "" };
  const basics = { name: "Morgan Example", email: "resume@example.com" };
  expect(resumeProfileChanges(profile, basics).map((change) => change.field)).toContain(
    "contactEmail",
  );
  profile.contactEmail = "chosen@example.com";
  expect(resumeProfileChanges(profile, basics).map((change) => change.field)).not.toContain(
    "contactEmail",
  );
});

test("history import adds only jobs and schools the profile does not list", () => {
  const profile = {
    ...structuredClone(USER_DEFAULT_VALUES),
    workHistory: [
      {
        company: "Oppfy App",
        title: "Software Engineer",
        location: "",
        start: "",
        end: "",
        summary: "",
      },
    ],
    educationHistory: [{ school: "Queen's University", degree: "", field: "", start: "", end: "" }],
  };
  const { jobs, schools } = resumeHistoryAdditions(profile, {
    experience: [
      { company: "oppfy app", title: "software engineer", start: "2023", bullets: [] },
      {
        company: "Compugen",
        title: "AI Lab Intern",
        location: "Toronto",
        start: "May 2025",
        end: "Present",
        bullets: ["Built a RAG assistant.", "Reached 86% top-1.", "Third bullet is left out."],
      },
    ],
    education: [
      { school: "Queen's University", degree: "BComp", details: [] },
      { school: "Seneca College", degree: "Diploma", start: "2020", end: "2022", details: [] },
    ],
  });
  expect(jobs).toEqual([
    {
      company: "Compugen",
      title: "AI Lab Intern",
      location: "Toronto",
      start: "May 2025",
      end: "",
      summary: "Built a RAG assistant. Reached 86% top-1.",
    },
  ]);
  expect(schools).toEqual([
    { school: "Seneca College", degree: "Diploma", field: "", start: "2020", end: "2022" },
  ]);
});
