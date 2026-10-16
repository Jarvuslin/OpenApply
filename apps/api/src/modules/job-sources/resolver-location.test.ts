import { canonicalLocationMatch } from "./resolver-location";
import { expect, it } from "bun:test";

it("normalizes Canadian province names and codes without dropping the city", () => {
  expect(canonicalLocationMatch("Toronto, Ontario, Canada", "Toronto, ON, Canada")).toBe(true);
  expect(canonicalLocationMatch("Toronto, Ontario, Canada", "Toronto, ON")).toBe(true);
  expect(canonicalLocationMatch("Montréal, Québec, Canada", "Montreal, QC")).toBe(true);
  expect(canonicalLocationMatch("Toronto, Ontario, Canada", "Ottawa, ON, Canada")).toBe(false);
});

it("matches a complete city and province within an employer's multiple offices", () => {
  expect(canonicalLocationMatch("Toronto, Ontario, Canada", "Toronto, ON, Saskatoon, SK")).toBe(
    true,
  );
  expect(
    canonicalLocationMatch("Saskatoon, Saskatchewan, Canada", "Toronto, ON, Saskatoon, SK"),
  ).toBe(true);
  expect(
    canonicalLocationMatch("Toronto, Saskatchewan, Canada", "Toronto, ON, Saskatoon, SK"),
  ).toBe(false);
  expect(canonicalLocationMatch("Toronto, Ontario, Canada", "Toronto; Saskatoon")).toBe(false);
});

it("keeps Ontario city in California distinct from the Canadian province", () => {
  expect(canonicalLocationMatch("Ontario, CA", "Ontario, California, United States")).toBe(true);
  expect(canonicalLocationMatch("Ontario, CA", "Ontario, Canada")).toBe(false);
  expect(canonicalLocationMatch("Ontario, CA", "Ontario, ON, Canada")).toBe(false);
  expect(canonicalLocationMatch("Toronto, Ontario, Canada", "Toronto, CA")).toBe(false);
});

it("rejects different or contradictory explicit regions and countries", () => {
  expect(canonicalLocationMatch("Toronto, Ontario, Canada", "Toronto, Quebec, Canada")).toBe(false);
  expect(canonicalLocationMatch("Toronto, Ontario, Canada", "Toronto, Ontario, US")).toBe(false);
  expect(canonicalLocationMatch("Waterloo, Ontario, Canada", "Kitchener, Waterloo")).toBe(false);
  expect(canonicalLocationMatch("Cambridge, MA, US", "Cambridge, ON, Canada")).toBe(false);
  expect(canonicalLocationMatch("Toronto", "Toronto")).toBeNull();
});
