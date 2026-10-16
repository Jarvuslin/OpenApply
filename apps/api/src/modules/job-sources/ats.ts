import { unprocessable } from "@/common/errors";
import { ashby } from "./ashby";
import { greenhouse } from "./greenhouse";
import { fetchSourceText } from "./http";
import { lever } from "./lever";
import { phenom } from "./phenom";
import type { FetchText } from "./public-feeds-wwr";
import { smartrecruiters } from "./smartrecruiters";
import { successfactors } from "./successfactors";
import type { FetchJson } from "./types";
import { workable } from "./workable";
import { workday } from "./workday";

const JSON_ATS = { ashby, greenhouse, lever, phenom, smartrecruiters, workable, workday };
export const ATS = { ...JSON_ATS, successfactors };
export type AtsProvider = keyof typeof ATS;
/** Slugs that name a career site rather than a company; their boards page through many requests. */
export const SITE_PROVIDERS: AtsProvider[] = ["phenom", "successfactors", "workday"];
export async function fetchAts(
  fetch: FetchJson,
  provider: AtsProvider,
  slug: string,
  company = slug,
  fetchText: FetchText = fetchSourceText,
) {
  // SuccessFactors career sites serve HTML search pages, not a JSON API.
  if (provider === "successfactors") return successfactors(fetchText, slug, company);
  // Site slugs contain dots and slashes and are checked by each adapter.
  if (!SITE_PROVIDERS.includes(provider) && !/^[a-zA-Z0-9_-][a-zA-Z0-9 _-]{0,79}$/.test(slug))
    throw unprocessable("Invalid employer board slug.");
  return JSON_ATS[provider](fetch, slug, company);
}
