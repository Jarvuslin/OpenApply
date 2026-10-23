import { discoverySearches } from "./discovery-plan";
import { expect, it } from "bun:test";

const preferences = {
  roles: ["Software engineering" as const, "Backend" as const],
  levels: ["Entry" as const],
  yearsExperience: null,
  workModes: [],
  employmentTypes: [],
};
it("derives bounded profile queries without changing role restrictions", () => {
  expect(discoverySearches(preferences, ["Toronto", "Toronto"], "")).toEqual([
    { query: "entry level software engineer", location: "Toronto" },
    { query: "entry level backend engineer", location: "Toronto" },
  ]);
});
it("uses original-source role suggestions when saved roles are unrestricted", () => {
  const unrestricted = { ...preferences, roles: [] };
  expect(discoverySearches(unrestricted, [], "Toronto, Canada", ["Software Engineer"])).toEqual([
    { query: "entry level Software Engineer", location: "Toronto, Canada" },
  ]);
  expect(unrestricted.roles).toEqual([]);
});
