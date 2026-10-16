import {
  CLASSIFIER_VERSION,
  classifyJob,
  familyIsNonTech,
  keepsJob,
  splitByTech,
} from "./tech-filter";
import { expect, it } from "bun:test";

it("keeps software, data, IT, security, QA, DevOps, cloud, ML, product and technical analyst roles", () => {
  for (const title of [
    "Software Engineer, New Grad",
    "Junior Developer",
    "Data Analyst Intern",
    "Senior Data Scientist",
    "IT Support Specialist",
    "Information Security Analyst",
    "QA Automation Engineer",
    "DevOps Engineer",
    "Cloud Infrastructure Engineer",
    "Machine Learning Engineer",
    "AI Research Intern",
    "Associate Product Manager",
    "Technical Analyst",
    "Business Systems Analyst",
    "Site Reliability Engineer",
    "Electrical Engineer, Embedded Software",
  ])
    expect(classifyJob(title)).toBe("tech");
});

it("drops clearly non-tech roles, including physical engineering", () => {
  for (const title of [
    "Registered Nurse - ICU",
    "Truck Driver (CDL-A)",
    "Retail Sales Associate",
    "Mechanical Engineer II",
    "Civil Engineer",
    "Electrical Engineer",
    "Manufacturing Engineer",
    "Personal Banker",
    "Financial Advisor",
    "Store Manager",
    "Data Entry Clerk",
    "Account Executive",
  ])
    expect(classifyJob(title)).toBe("non_tech");
});

it("does not drop roles that only share a word with non-tech work", () => {
  for (const title of [
    "Chef/fe de projet - Aéroline",
    "Projects & Delivery Intern",
    "Information System Security Officer",
    "Advisory Solution Consultant",
    "Technical Account Manager",
    "Product Marketing Manager",
    "Consultant - Pharmacovigilance/Safety Systems Implementation",
    "Senior Sales Engineer",
  ])
    expect(keepsJob(title)).toBe(true);
  expect(classifyJob("Delivery Driver")).toBe("non_tech");
  expect(classifyJob("Line Cook")).toBe("non_tech");
});

it("decides a bare engineer title from its description, keeping it when unsure", () => {
  expect(
    classifyJob("Engineer II", "Build APIs in Python and deploy them on AWS with Docker."),
  ).toBe("tech");
  expect(
    classifyJob("Engineer II", "Design HVAC piping in AutoCAD and review welding on site."),
  ).toBe("non_tech");
  expect(classifyJob("Engineer II", "")).toBe("unsure");
  expect(keepsJob("Engineer II", "")).toBe(true);
  expect(keepsJob("Associate, Operations")).toBe(true);
});

it("treats only clearly non-tech Workday families as skippable", () => {
  expect(familyIsNonTech("Retail Sales & Service")).toBe(true);
  expect(familyIsNonTech("Client Relationships")).toBe(true);
  expect(familyIsNonTech("Technology Solutions")).toBe(false);
  expect(familyIsNonTech("IT - Information Technology")).toBe(false);
  expect(familyIsNonTech("Engineering")).toBe(false);
  expect(familyIsNonTech("Operations")).toBe(false);
  expect(familyIsNonTech("Analytics, Insights, & Artificial Intelligence")).toBe(false);
});

it("skips jobs dropped under this classifier version and re-checks older drops", () => {
  const job = (externalId: string, title: string) => ({
    title,
    company: "Acme",
    location: "Toronto",
    url: `https://example.com/${externalId}`,
    attributionUrl: `https://example.com/${externalId}`,
    externalId,
    description: "",
    postedAt: null,
  });
  const split = splitByTech(
    [
      job("1", "Software Engineer"),
      job("2", "Retail Sales Associate"),
      job("3", "Cashier"),
      job("4", "Data Analyst"),
      job("5", "Store Manager"),
    ],
    new Map([
      ["3", CLASSIFIER_VERSION],
      ["4", CLASSIFIER_VERSION - 1],
      ["5", CLASSIFIER_VERSION - 1],
    ]),
  );
  expect(split.kept.map((kept) => kept.externalId)).toEqual(["1", "4"]);
  // 3 is skipped unclassified; 2 and 5 are dropped now, and 4 is cleared because it passes.
  expect(split.drop).toEqual(["2", "5"]);
  expect(split.clear).toEqual(["4"]);
  expect(split.dropped).toBe(3);
});
