import { linkedinSearchSchema } from "@openapply/contracts/linkedin-discovery";
import { linkedinFilterReason, linkedinJobUrl } from "./linkedin-filter";
import type { SourceJob } from "./types";
import { describe, expect, it } from "bun:test";

const search = linkedinSearchSchema.parse({
  query: "software engineer",
  location: "Toronto, Canada",
});
const job: SourceJob = {
  title: "Software Engineer I",
  company: "Acme",
  location: "Toronto, ON, Canada",
  url: "https://www.linkedin.com/jobs/view/123",
  attributionUrl: "https://www.linkedin.com/jobs/view/123",
  description: "",
  postedAt: null,
};

describe("LinkedIn post-filtering", () => {
  it("rejects senior titles even if LinkedIn supplied an entry filter or low experience", () => {
    for (const title of [
      "Senior Engineer",
      "Staff Software Engineer",
      "Associate Director",
      "Engineering Manager",
      "Tech Lead",
    ])
      expect(
        linkedinFilterReason({ ...job, title, description: "1 year of experience" }, search),
      ).toBe("seniority");
  });
  it("accepts explicit entry titles and low required experience, excluding unexplained generic titles", () => {
    for (const title of [
      "Junior Developer",
      "New Grad Engineer",
      "Entry-Level Engineer",
      "Associate Engineer",
      "Software Engineer I",
    ])
      expect(linkedinFilterReason({ ...job, title }, search)).toBeNull();
    expect(
      linkedinFilterReason(
        {
          ...job,
          title: "Software Engineer",
          description: "2 years of professional experience required",
        },
        search,
      ),
    ).toBeNull();
    expect(linkedinFilterReason({ ...job, title: "Software Engineer" }, search)).toBe(
      "unverified entry level",
    );
    expect(linkedinFilterReason({ ...job, title: "Software Engineer III" }, search)).not.toBeNull();
  });
  it("enforces required experience without treating preferred years as mandatory", () => {
    expect(
      linkedinFilterReason({ ...job, description: "5 years of experience required" }, search),
    ).toBe("experience");
    expect(
      linkedinFilterReason({ ...job, description: "5 years of experience preferred" }, search),
    ).toBeNull();
  });
  it("keeps internship and entry preferences distinct", () => {
    expect(linkedinFilterReason({ ...job, title: "Software Engineering Intern" }, search)).toBe(
      "internship",
    );
    const interns = { ...search, experienceLevels: ["intern"] as const };
    expect(
      linkedinFilterReason(
        { ...job, title: "Software Engineering Intern" },
        { ...interns, experienceLevels: [...interns.experienceLevels] },
      ),
    ).toBeNull();
    expect(linkedinFilterReason(job, { ...search, experienceLevels: ["intern"] })).toBe("entry");
  });
  it("enforces location, country and remote restrictions without assuming remote means anywhere", () => {
    expect(linkedinFilterReason({ ...job, location: "Seattle, WA, USA" }, search)).toBe("location");
    const remote = { ...search, remoteOnly: true, countries: ["CA"] };
    expect(linkedinFilterReason(job, remote)).toBe("location");
    expect(
      linkedinFilterReason({ ...job, location: "Remote, Canada", workMode: "remote" }, remote),
    ).toBeNull();
    expect(
      linkedinFilterReason(
        { ...job, location: "Remote, United States", workMode: "remote" },
        remote,
      ),
    ).toBe("location");
    expect(linkedinFilterReason({ ...job, location: "Remote", workMode: "remote" }, remote)).toBe(
      "location",
    );
    expect(
      linkedinFilterReason({ ...job, location: "Remote, Worldwide", workMode: "remote" }, remote),
    ).toBeNull();
  });
  it("dedupes tracking links and slug variations using the LinkedIn posting ID", () => {
    expect(linkedinJobUrl("https://ca.linkedin.com/jobs/view/junior-engineer-123?trk=abc")).toBe(
      linkedinJobUrl("https://www.linkedin.com/jobs/view/123/"),
    );
  });
});
