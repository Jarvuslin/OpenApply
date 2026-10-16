import type { jobPreferencesSchema } from "@openapply/contracts/user";
import type { z } from "zod/v4";

const ROLE_QUERY: Record<string, string> = {
  "Software engineering": "software engineer",
  Frontend: "frontend engineer",
  Backend: "backend engineer",
  "Full stack": "full stack engineer",
  Mobile: "mobile engineer",
  "Data engineering": "data engineer",
  "DevOps / platform": "platform engineer",
  "QA / test": "QA engineer",
  Security: "security engineer",
};

export function discoverySearches(
  preferences: z.infer<typeof jobPreferencesSchema>,
  locations: string[],
  fallbackLocation: string,
  suggestedRoles: string[] = [],
) {
  const places = [...new Set(locations.map((value) => value.trim()).filter(Boolean))];
  if (!places.length) places.push(fallbackLocation);
  const roles = preferences.roles.map((role) => ROLE_QUERY[role] ?? role);
  const levels = preferences.levels;
  const prefix = levels.length === 1 && levels[0] === "Entry" ? "entry level " : "";
  const queries = roles.length ? roles : suggestedRoles;
  if (!queries.length) queries.push("jobs");
  return queries
    .flatMap((role) => places.map((location) => ({ query: `${prefix}${role}`, location })))
    .slice(0, 24);
}
