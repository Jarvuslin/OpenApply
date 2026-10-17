/** When sources disagree, the higher rank wins: its apply link and fields are the listing's. */
export const SOURCE_RANK = {
  employerAts: 4,
  careerSite: 3,
  curatedList: 2,
  aggregator: 1,
  other: 0,
} as const;

const RANKS: Record<string, number> = {
  ashby: SOURCE_RANK.employerAts,
  greenhouse: SOURCE_RANK.employerAts,
  lever: SOURCE_RANK.employerAts,
  smartrecruiters: SOURCE_RANK.employerAts,
  workable: SOURCE_RANK.employerAts,
  workday: SOURCE_RANK.employerAts,
  successfactors: SOURCE_RANK.careerSite,
  phenom: SOURCE_RANK.careerSite,
  "google-careers": SOURCE_RANK.careerSite,
  "simplify-new-grad": SOURCE_RANK.curatedList,
  "simplify-internships": SOURCE_RANK.curatedList,
  "canadian-internships": SOURCE_RANK.curatedList,
  hackernews: SOURCE_RANK.aggregator,
  "hackernews-jobs": SOURCE_RANK.aggregator,
  remoteok: SOURCE_RANK.aggregator,
  weworkremotely: SOURCE_RANK.aggregator,
  google_jobs: SOURCE_RANK.aggregator,
  linkedin: SOURCE_RANK.aggregator,
  "linkedin-jobspy": SOURCE_RANK.aggregator,
  indeed: SOURCE_RANK.aggregator,
  glassdoor: SOURCE_RANK.aggregator,
  ycombinator: SOURCE_RANK.aggregator,
};

/** The rank of the board a source was read from, by its `board` value. */
export function sourceRank(board: string | null | undefined): number {
  return RANKS[board?.toLowerCase() ?? ""] ?? SOURCE_RANK.other;
}
