import { State } from "country-state-city";

type Region = { country: string; code: string };
type Place = Region & { city: string };

const normalize = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const regions = new Map<string, Region>();
for (const country of ["CA", "US"])
  for (const state of State.getStatesOfCountry(country)) {
    const region = { country, code: state.isoCode };
    regions.set(normalize(state.name), region);
    regions.set(normalize(state.isoCode), region);
  }
const countries = new Map([
  ["canada", "CA"],
  ["ca", "CA"],
  ["can", "CA"],
  ["united states", "US"],
  ["united states of america", "US"],
  ["us", "US"],
  ["usa", "US"],
]);

function places(value: string): Place[] | null {
  const parts = value.split(/[,;|]/).map(normalize).filter(Boolean);
  const result: Place[] = [];
  for (let index = 0; index < parts.length; ) {
    const city = parts[index++];
    const region = regions.get(parts[index++] ?? "");
    if (!city || !region) return result.length ? [] : null;
    // A second-position CA is California; only a following country qualifies the region.
    const country = countries.get(parts[index] ?? "");
    if (country) {
      if (country !== region.country) return [];
      index++;
    }
    result.push({ city, ...region });
  }
  return result.length ? result : null;
}

export function canonicalLocationMatch(left: string, right: string): boolean | null {
  const a = places(left);
  const b = places(right);
  if (a === null && b === null) return null;
  if (a === null || b === null) return false;
  return a.some((place) =>
    b.some(
      (other) =>
        place.city === other.city && place.code === other.code && place.country === other.country,
    ),
  );
}
