import { Country } from "country-state-city";

export const CONTINENTS = [
  "North America",
  "South America",
  "Europe",
  "Asia",
  "Africa",
  "Oceania",
] as const;
type Continent = (typeof CONTINENTS)[number];

const SOUTH_AMERICA = new Set("AR BO BR CL CO EC FK GF GS GY PE PY SR UY VE".split(" "));
// Island and border countries whose first time zone names the wrong continent.
const OVERRIDES: Record<string, Continent> = {
  IS: "Europe",
  FO: "Europe",
  CY: "Europe",
  BM: "North America",
  MV: "Asia",
  IO: "Asia",
  CV: "Africa",
  MU: "Africa",
  SC: "Africa",
  KM: "Africa",
  MG: "Africa",
  RE: "Africa",
  YT: "Africa",
  SH: "Africa",
  ST: "Africa",
};
const ZONE_CONTINENTS: Record<string, Continent> = {
  Africa: "Africa",
  Asia: "Asia",
  Europe: "Europe",
  Australia: "Oceania",
  Pacific: "Oceania",
};

function continentOf(code: string, zone: string | undefined): Continent | null {
  if (OVERRIDES[code]) return OVERRIDES[code];
  if (SOUTH_AMERICA.has(code)) return "South America";
  const area = zone?.split("/")[0] ?? "";
  if (area === "America") return "North America";
  return ZONE_CONTINENTS[area] ?? null;
}

let byContinent: Map<string, string[]> | null = null;

/** ISO country codes on a continent, or null when the name is not a continent. */
export function continentCountries(name: string): string[] | null {
  if (!byContinent) {
    byContinent = new Map(CONTINENTS.map((continent) => [continent.toLowerCase(), []]));
    for (const country of Country.getAllCountries()) {
      const continent = continentOf(country.isoCode, country.timezones?.[0]?.zoneName);
      if (continent) byContinent.get(continent.toLowerCase())?.push(country.isoCode);
    }
  }
  return byContinent.get(name.trim().toLowerCase()) ?? null;
}
