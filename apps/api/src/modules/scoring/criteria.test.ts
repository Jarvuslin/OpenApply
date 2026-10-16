import { jobCriteria } from "./criteria";
import { DESCRIPTION } from "./fakes";
import { expect, it } from "bun:test";

it("covers all non-whitespace JD characters with stable original offsets", () => {
  const criteria = jobCriteria(DESCRIPTION, "Frontend Engineer", "Example");
  expect(criteria).toEqual(jobCriteria(DESCRIPTION, "Frontend Engineer", "Example"));
  const covered = new Set<number>();
  for (const criterion of criteria) {
    expect(DESCRIPTION.slice(criterion.start, criterion.end)).toBe(criterion.text);
    for (let i = criterion.start; i < criterion.end; i++) covered.add(i);
  }
  for (let i = 0; i < DESCRIPTION.length; i++)
    if (DESCRIPTION[i].trim()) expect(covered.has(i)).toBe(true);
  expect(criteria.filter((item) => item.isHeading)).toHaveLength(3);
  expect(criteria.find((item) => item.text.startsWith("Develop service"))?.section).toBe(
    "responsibilities",
  );
});

it("keeps prose outside recognized headings and splits sentences instead of dropping responsibilities", () => {
  const prose = DESCRIPTION.replaceAll("\n", " ");
  const criteria = jobCriteria(prose, "Frontend Engineer", "Example");
  expect(criteria.length).toBeGreaterThan(1);
  expect(criteria.some((item) => item.text.includes("Develop service endpoints"))).toBe(true);
});

it("does not treat a responsibility sentence as a heading", () => {
  const description = DESCRIPTION.replace(
    "Develop service",
    "Responsibilities include developing service",
  );
  const criterion = jobCriteria(description, "Frontend Engineer", "Example").find((item) =>
    item.text.startsWith("Responsibilities include"),
  );
  expect(criterion?.isHeading).toBe(false);
  expect(criterion?.section).toBe("responsibilities");
});

it("keeps uppercase and formatted skill requirements assessable", () => {
  const description = DESCRIPTION.replace(
    "Requirements\n",
    "Requirements\nSQL\nAWS\nHTML/CSS\n## CI/CD\nAPI:\n",
  );
  const criteria = jobCriteria(description, "Frontend Engineer", "Example");
  for (const skill of ["SQL", "AWS", "HTML/CSS", "## CI/CD", "API:"]) {
    expect(criteria.find((item) => item.text === skill)).toMatchObject({
      isHeading: false,
      section: "requirements",
    });
  }
});

it("rejects thin and oversized descriptions rather than pretending an excerpt is complete", () => {
  expect(() => jobCriteria("Frontend role", "Frontend Engineer", "Example")).toThrow("too thin");
  expect(() => jobCriteria("Job description ".repeat(20_000), "Role", "Employer")).toThrow(
    "not truncated",
  );
});
