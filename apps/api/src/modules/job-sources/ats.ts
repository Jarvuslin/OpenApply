import { unprocessable } from "@/common/errors";
import { ashby } from "./ashby";
import { greenhouse } from "./greenhouse";
import { lever } from "./lever";
import { smartrecruiters } from "./smartrecruiters";
import type { FetchJson } from "./types";
import { workable } from "./workable";

export const ATS = { ashby, greenhouse, lever, smartrecruiters, workable };
export type AtsProvider = keyof typeof ATS;
export async function fetchAts(
  fetch: FetchJson,
  provider: AtsProvider,
  slug: string,
  company = slug,
) {
  if (!/^[a-zA-Z0-9_-][a-zA-Z0-9 _-]{0,79}$/.test(slug))
    throw unprocessable("Invalid employer board slug.");
  return ATS[provider](fetch, slug, company);
}
