import { City, Country, State } from "country-state-city";
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
