import { City, Country, type ICountry, type IState, State } from "country-state-city";
import { z } from "zod/v4";
import type { Prisma } from "@/generated/prisma/client";
import { CONTINENTS, continentCountries } from "./continents";

export function locationSuggestions(query: { country?: string; state?: string }) {
  const countries = Country.getAllCountries().map((c) => ({ code: c.isoCode, name: c.name }));
  const country = countries.find((c) => c.code === query.country || c.name === query.country);
  const states = country
    ? State.getStatesOfCountry(country.code).map((s) => ({ code: s.isoCode, name: s.name }))
    : [];
  const state = states.find((s) => s.code === query.state || s.name === query.state);
  const cities =
    country && state ? City.getCitiesOfState(country.code, state.code).map((c) => c.name) : [];
  return { countries, states, cities: [...new Set(cities)], countryCode: country?.code ?? null };
}

type PlaceKind = "continent" | "country" | "region" | "city";

interface PlaceResult {
  label: string;
  kind: PlaceKind | "postal";
  postalCode?: string;
}

interface Place {
  label: string;
  kind: PlaceKind;
  name: string;
  /** Folded name, kept so a search does not fold 150k cities per keystroke. */
  key: string;
  countryCode: string;
  major: boolean;
}

/** Lower-case without accents, so "montreal" finds "Montréal". */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

// The dataset has no population, so big job markets rank first and short names beat long ones.
const COUNTRY_PRIORITY = ["CA", "US", "GB", "AU", "IE", "DE", "FR", "NL", "IN", "SG"];
const MAJOR_CITIES = new Set([
  "Toronto, Ontario, Canada",
  "Vancouver, British Columbia, Canada",
  "Montréal, Quebec, Canada",
  "Calgary, Alberta, Canada",
  "Ottawa, Ontario, Canada",
  "Edmonton, Alberta, Canada",
  "Waterloo, Ontario, Canada",
  "Mississauga, Ontario, Canada",
  "Winnipeg, Manitoba, Canada",
  "Halifax, Nova Scotia, Canada",
  "Victoria, British Columbia, Canada",
  "New York City, New York, United States",
  "San Francisco, California, United States",
  "Seattle, Washington, United States",
  "Los Angeles, California, United States",
  "Austin, Texas, United States",
  "Boston, Massachusetts, United States",
  "Chicago, Illinois, United States",
  "Denver, Colorado, United States",
  "Atlanta, Georgia, United States",
  "Miami, Florida, United States",
  "Dallas, Texas, United States",
  "Philadelphia, Pennsylvania, United States",
  "San Jose, California, United States",
  "Phoenix, Arizona, United States",
  "Minneapolis, Minnesota, United States",
  "Pittsburgh, Pennsylvania, United States",
  "Salt Lake City, Utah, United States",
  "Raleigh, North Carolina, United States",
  "Detroit, Michigan, United States",
  "Palo Alto, California, United States",
  "Mountain View, California, United States",
  "Sunnyvale, California, United States",
  "Cambridge, Massachusetts, United States",
  "London, England, United Kingdom",
  "Manchester, England, United Kingdom",
  "Edinburgh, Scotland, United Kingdom",
  "Dublin, Leinster, Ireland",
  "Berlin, Berlin, Germany",
  "Munich, Bavaria, Germany",
  "Paris, Île-de-France, France",
  "Amsterdam, North Holland, Netherlands",
  "Stockholm, Stockholm County, Sweden",
  "Barcelona, Catalonia, Spain",
  "Madrid, Madrid, Spain",
  "Lisbon, Lisbon, Portugal",
  "Warsaw, Masovian Voivodeship, Poland",
  "Tel Aviv, Tel Aviv District, Israel",
  "Bengaluru, Karnataka, India",
  "Hyderabad, Telangana, India",
  "Mumbai, Maharashtra, India",
  "Tokyo, Tokyo, Japan",
  "Seoul, Seoul, South Korea",
  "Sydney, New South Wales, Australia",
  "Melbourne, Victoria, Australia",
  "São Paulo, São Paulo, Brazil",
  "Dubai, Dubai, United Arab Emirates",
]);
const KIND_ORDER: Record<PlaceKind, number> = { continent: 0, country: 1, region: 2, city: 3 };
const SEARCH_LIMIT = 10;

let places: Place[] | null = null;

function placeIndex(): Place[] {
  if (places) return places;
  const countries = new Map<string, ICountry>(Country.getAllCountries().map((c) => [c.isoCode, c]));
  const states = new Map<string, IState>(
    State.getAllStates().map((s) => [`${s.countryCode}-${s.isoCode}`, s]),
  );
  const seen = new Set<string>();
  const all: Place[] = [];
  function add(kind: PlaceKind, name: string, label: string, countryCode: string): void {
    if (seen.has(label)) return;
    seen.add(label);
    all.push({ label, kind, name, key: fold(name), countryCode, major: MAJOR_CITIES.has(label) });
  }
  for (const continent of CONTINENTS) add("continent", continent, continent, "");
  for (const country of countries.values())
    add("country", country.name, country.name, country.isoCode);
  for (const state of states.values()) {
    const country = countries.get(state.countryCode);
    if (country) add("region", state.name, `${state.name}, ${country.name}`, country.isoCode);
  }
  for (const city of City.getAllCities()) {
    const country = countries.get(city.countryCode);
    const state = states.get(`${city.countryCode}-${city.stateCode}`);
    if (country && state) {
      add("city", city.name, `${city.name}, ${state.name}, ${country.name}`, country.isoCode);
    }
  }
  places = all;
  return all;
}

function countryRank(code: string): number {
  const index = COUNTRY_PRIORITY.indexOf(code);
  return index === -1 ? COUNTRY_PRIORITY.length : index;
}

const POSTAL_PATTERNS = [
  { country: "us", pattern: /^(\d{5})(?:-\d{4})?$/ },
  // Canada's lookup knows the first three characters (the area), not the full code.
  { country: "ca", pattern: /^([a-z]\d[a-z])\s?(?:\d[a-z]\d)?$/i },
] as const;
const postalCache = new Map<string, PlaceResult[]>();
const postalPlaceSchema = z.object({
  places: z.array(z.object({ "place name": z.string(), state: z.string() })),
});

/** The dataset city a postal area names, like "Downtown Toronto (…)" → Toronto, Ontario. */
function postalCity(placeName: string, region: string, country: string): string {
  const text = fold(placeName);
  const city = placeIndex()
    .filter(
      (place) =>
        place.kind === "city" &&
        place.label.endsWith(`, ${region}, ${country}`) &&
        new RegExp(`(^|[^a-z])${place.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z])`).test(
          text,
        ),
    )
    .toSorted((a, b) => b.key.length - a.key.length)[0];
  if (city) return city.label;
  return country === "United States"
    ? `${placeName}, ${region}, ${country}`
    : `${region}, ${country}`;
}

/** US ZIP codes and Canadian postal codes, resolved to the city they cover. */
async function searchPostal(text: string): Promise<PlaceResult[]> {
  const typed = text.trim();
  const match = POSTAL_PATTERNS.map(({ country, pattern }) => ({
    country,
    code: pattern.exec(typed)?.[1]?.toUpperCase(),
  })).find((entry) => entry.code);
  if (!match?.code) return [];
  const cacheKey = `${match.country}/${match.code}`;
  const cached = postalCache.get(cacheKey);
  if (cached) return cached;
  try {
    const response = await fetch(`https://api.zippopotam.us/${cacheKey}`, {
      signal: AbortSignal.timeout(3000),
    });
    const parsed = response.ok ? postalPlaceSchema.safeParse(await response.json()) : null;
    const countryName = match.country === "us" ? "United States" : "Canada";
    const labels = (parsed?.data?.places ?? []).map((place) =>
      postalCity(place["place name"], place.state, countryName),
    );
    const results = [...new Set(labels)].map((label) => ({
      label,
      kind: "postal" as const,
      postalCode: match.code,
    }));
    postalCache.set(cacheKey, results);
    return results;
  } catch {
    return [];
  }
}

/**
 * Postal codes, then continents, countries, regions and cities whose name starts with the search
 * text, or has a word that does. Text after a comma narrows, as in "london, ontario".
 */
export async function searchPlaces(text: string): Promise<PlaceResult[]> {
  const postal = await searchPostal(text);
  const names = searchNames(text).filter((place) => !postal.some((p) => p.label === place.label));
  return [...postal, ...names].slice(0, SEARCH_LIMIT);
}

function searchNames(text: string): PlaceResult[] {
  const [term = "", ...within] = fold(text)
    .split(",")
    .map((part) => part.trim());
  if (!term) return [];
  const matches: { place: Place; start: boolean }[] = [];
  for (const place of placeIndex()) {
    const at = place.key.indexOf(term);
    if (at === -1 || (at > 0 && place.key[at - 1] !== " ")) continue;
    if (within.some((part) => !fold(place.label).includes(part))) continue;
    matches.push({ place, start: at === 0 });
  }
  return matches
    .toSorted(
      (a, b) =>
        Number(b.start && b.place.major) - Number(a.start && a.place.major) ||
        Number(b.place.key === term) - Number(a.place.key === term) ||
        Number(b.start) - Number(a.start) ||
        KIND_ORDER[a.place.kind] - KIND_ORDER[b.place.kind] ||
        countryRank(a.place.countryCode) - countryRank(b.place.countryCode) ||
        a.place.name.length - b.place.name.length ||
        a.place.label.localeCompare(b.place.label),
    )
    .slice(0, SEARCH_LIMIT)
    .map(({ place }) => ({ label: place.label, kind: place.kind }));
}

function containsText(value: string): Prisma.JobListingWhereInput {
  const plain = value.normalize("NFD").replace(/\p{M}/gu, "");
  if (plain === value) return { location: { contains: value, mode: "insensitive" } };
  // Postings often drop accents: "Montreal" for "Montréal".
  return { OR: [containsText(plain), { location: { contains: value, mode: "insensitive" } }] };
}

/**
 * A picked place as a listing filter. Labels come from `searchPlaces`: a continent, "Country",
 * "Region, Country" or "City, Region, Country". Anything else matches on its first comma part.
 */
export function placeWhere(label: string): Prisma.JobListingWhereInput {
  const parts = label.split(",").map((part) => part.trim());
  const continent = continentCountries(label);
  if (continent) return { countries: { hasSome: continent } };
  const countryName = parts.at(-1) ?? "";
  const country = Country.getAllCountries().find(
    (c) => c.name.toLowerCase() === countryName.toLowerCase(),
  );
  if (!country || parts.length > 3) return containsText(parts[0] || label);
  if (parts.length === 1) {
    return { OR: [{ countries: { has: country.isoCode } }, containsText(country.name)] };
  }
  // Listings that name no country still match by place name.
  const inCountry: Prisma.JobListingWhereInput = {
    OR: [{ countries: { has: country.isoCode } }, { countries: { isEmpty: true } }],
  };
  if (parts.length === 3) return { AND: [containsText(parts[0] ?? ""), inCountry] };
  const state = State.getStatesOfCountry(country.isoCode).find(
    (s) => s.name.toLowerCase() === parts[0]?.toLowerCase(),
  );
  if (!state) return containsText(parts[0] ?? "");
  // Postings usually abbreviate the region, as in "Toronto, ON".
  const byCode = /^[A-Z]{2,3}$/.test(state.isoCode) ? [containsText(`, ${state.isoCode}`)] : [];
  return { AND: [{ OR: [containsText(state.name), ...byCode] }, inCountry] };
}
