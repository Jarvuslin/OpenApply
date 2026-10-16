import { State } from "country-state-city";

const countryNames = {
  CA: /\b(?:canada|canadian|can)\b/i,
  US: /\b(?:united states(?: of america)?|usa|u\.?s\.?(?:a\.?)?)\b/i,
};
const cityNames = {
  CA: /\b(?:toronto|montreal|montréal|ottawa|calgary|edmonton|winnipeg|quebec city|québec|waterloo|kitchener|mississauga|burnaby|vancouver|victoria, bc)\b/i,
  US: /\b(?:san francisco|new york|nyc|seattle|boston|austin|los angeles|san diego|san jose|chicago|denver|atlanta|miami|washington,? dc|palo alto|mountain view|redwood city|menlo park|sunnyvale|santa clara|cupertino|bellevue|portland|pittsburgh|philadelphia|dallas|houston|raleigh|durham|salt lake city)\b/i,
};
const states = ["CA", "US"].map((country) => ({
  country,
  names: State.getStatesOfCountry(country).map((state) => state.name.toLowerCase()),
  // Region codes count only as a location segment, so "in" and "or" cannot match prose.
  codes: State.getStatesOfCountry(country).map((state) => state.isoCode),
}));

/** Location labels describe where the job is based, never the candidate's work authorization. */
export function listingCountries(location: string | null | undefined): string[] {
  if (!location) return [];
  const result = new Set<string>();
  for (const country of ["CA", "US"] as const) {
    if (countryNames[country].test(location)) result.add(country);
  }
  const segments = location.split(/[,;|/()]/).map((part) => part.trim());
  for (const state of states) {
    if (
      segments.some((part) => state.codes.includes(part)) ||
      state.names.some((name) => new RegExp(`\\b${name}\\b`, "i").test(location))
    )
      result.add(state.country);
  }
  // Explicit countries/regions take precedence over cities with namesakes in another country.
  if (!result.size) {
    for (const country of ["CA", "US"] as const) {
      if (cityNames[country].test(location)) result.add(country);
    }
  }
  return [...result].sort();
}

const COUNTRY_ALIASES: Record<string, string> = {
  USA: "US",
  CAN: "CA",
  GBR: "GB",
  DEU: "DE",
  AUS: "AU",
  "UNITED STATES": "US",
  "UNITED STATES OF AMERICA": "US",
  CANADA: "CA",
};

export function listingCountryCodes(
  countries: string[] | undefined,
  location: string | null,
): string[] {
  const explicit = (countries ?? [])
    .map((country) => country.trim().toUpperCase())
    .map((country) => COUNTRY_ALIASES[country] ?? country)
    .filter((country) => /^[A-Z]{2,3}$/.test(country));
  // Preserve other explicit countries so an overseas namesake city cannot become a US/CA job.
  return explicit.length ? [...new Set(explicit)].sort() : listingCountries(location);
}
