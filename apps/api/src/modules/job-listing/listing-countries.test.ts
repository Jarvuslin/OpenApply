import { listingCountries, listingCountryCodes } from "./listing-countries";
import { buildListingDraft } from "./listing-draft";
import { expect, it } from "bun:test";

it("recognizes US and Canadian cities, regions and explicitly remote markets", () => {
  for (const location of [
    "New York",
    "San Francisco",
    "Austin, TX",
    "Remote - US",
    "United States",
    "Denver, Colorado",
  ]) {
    expect(listingCountries(location)).toEqual(["US"]);
  }
  for (const location of [
    "Toronto",
    "Montreal",
    "Remote - Canada",
    "Ottawa, ON",
    "London, Ontario",
  ]) {
    expect(listingCountries(location)).toEqual(["CA"]);
  }
  expect(listingCountries("Remote (US / Canada)")).toEqual(["CA", "US"]);
  expect(listingCountries("Remote")).toEqual([]);
  expect(listingCountries("London, UK")).toEqual([]);
  expect(listingCountries(null)).toEqual([]);
});

it("prefers structured country metadata to an ambiguous city name", () => {
  const listing = buildListingDraft({
    title: "Engineer",
    company: "Example",
    url: "https://example.com/jobs/1",
    publicFeed: true,
    location: "Vancouver",
    countries: ["us"],
  });
  expect(listing?.countries).toEqual(["US"]);
});

it("normalizes three-letter ATS country codes and falls back when explicit metadata is invalid", () => {
  expect(listingCountryCodes(["USA", "CAN", "USA"], "Toronto")).toEqual(["CA", "US"]);
  expect(listingCountryCodes(["GBR"], "London")).toEqual(["GB"]);
  expect(listingCountryCodes(["NZL"], "Wellington")).toEqual(["NZL"]);
  expect(listingCountryCodes(["", "unknown"], "San Francisco")).toEqual(["US"]);
});
