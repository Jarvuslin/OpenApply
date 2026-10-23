import { fetchSourceText } from "./http";
import { canadianInternships } from "./public-feeds-canada";
import { googleCareers } from "./public-feeds-google";
import { hackerNewsHiring, hackerNewsJobs } from "./public-feeds-hackernews";
import { remoteOk } from "./public-feeds-remoteok";
import { simplifyInternships, simplifyNewGrad } from "./public-feeds-simplify";
import { type FetchText, weWorkRemotely } from "./public-feeds-wwr";
import type { FetchJson, SourceJob } from "./types";

export type PublicFeedId =
  | "remoteok"
  | "weworkremotely"
  | "hackernews"
  | "hackernews-jobs"
  | "google-careers"
  | "simplify-new-grad"
  | "simplify-internships"
  | "canadian-internships";

export function publicFeed(
  fetchJson: FetchJson,
  sourceId: PublicFeedId,
  fetchText: FetchText = fetchSourceText,
): Promise<SourceJob[]> {
  switch (sourceId) {
    case "remoteok":
      return remoteOk(fetchJson);
    case "weworkremotely":
      return weWorkRemotely(fetchText);
    case "hackernews":
      return hackerNewsHiring(fetchJson);
    case "hackernews-jobs":
      return hackerNewsJobs(fetchJson);
    case "google-careers":
      return googleCareers(fetchText);
    case "simplify-new-grad":
      return simplifyNewGrad(fetchJson);
    case "simplify-internships":
      return simplifyInternships(fetchJson);
    case "canadian-internships":
      return canadianInternships(fetchText);
  }
}
