import { unprocessable } from "@/common/errors";
import { ashby } from "./ashby";
import { greenhouse } from "./greenhouse";
import { fetchSourceText } from "./http";
import { icims } from "./icims";
import { jibe } from "./jibe";
import { lever } from "./lever";
import { oracle } from "./oracle";
import { phenom } from "./phenom";
import type { FetchText } from "./public-feeds-wwr";
import { recruitee } from "./recruitee";
import { smartrecruiters } from "./smartrecruiters";
import { successfactors } from "./successfactors";
import { taleo } from "./taleo";
import { teamtailor } from "./teamtailor";
import type { BoardOptions, BoardResult, FetchJson } from "./types";
import { workable } from "./workable";
import { workday } from "./workday";

const JSON_ATS = {
  ashby,
  greenhouse,
  jibe,
  lever,
  oracle,
  phenom,
  recruitee,
  smartrecruiters,
  workable,
  workday,
};
export const ATS = { ...JSON_ATS, icims, successfactors, taleo, teamtailor };
export type AtsProvider = keyof typeof ATS;
/** Slugs that name a career site rather than a company; their boards page through many requests. */
export const SITE_PROVIDERS: AtsProvider[] = [
  "icims",
  "jibe",
  "oracle",
  "phenom",
  "successfactors",
  "taleo",
  "workday",
];
export async function fetchAts(
  fetch: FetchJson,
  provider: AtsProvider,
  slug: string,
  company = slug,
  options: BoardOptions = {},
  fetchText: FetchText = fetchSourceText,
): Promise<BoardResult> {
  // SuccessFactors career sites serve HTML search pages, not a JSON API.
  if (provider === "successfactors") return successfactors(fetchText, slug, company, options);
  // So do iCIMS portals.
  if (provider === "icims") return icims(fetchText, slug, company, options);
  // Teamtailor boards are read from their RSS feed; a slug can name a region, "acme.na".
  if (provider === "teamtailor") return teamtailor(fetchText, slug, company);
  // Taleo names its job board API on the section's search page.
  if (provider === "taleo") return taleo(fetch, fetchText, slug, company, options);
  // Site slugs contain dots and slashes and are checked by each adapter.
  if (!SITE_PROVIDERS.includes(provider) && !/^[a-zA-Z0-9_-][a-zA-Z0-9 _-]{0,79}$/.test(slug))
    throw unprocessable("Invalid employer board slug.");
  return JSON_ATS[provider](fetch, slug, company, options);
}
