import type { ApplicationStatus } from "@openapply/contracts/application";

interface OutcomeRow {
  id: string;
  status: ApplicationStatus;
}

/**
 * Where every application ended up, for the outcome flow chart. An application counts as
 * interviewed once it reached screening, interviewing or offer, even if it was later rejected.
 */
export function applicationOutcomes(rows: OutcomeRow[], reachedInterview: Set<string>) {
  const outcomes = {
    total: rows.length,
    rejected: 0,
    noAnswer: 0,
    withdrawn: 0,
    interviews: 0,
    offers: 0,
    noOffer: 0,
    withdrewAfterInterview: 0,
    interviewing: 0,
  };
  for (const row of rows) {
    const interviewed =
      reachedInterview.has(row.id) || ["screening", "interviewing", "offer"].includes(row.status);
    if (!interviewed) {
      if (row.status === "rejected") outcomes.rejected++;
      else if (row.status === "withdrawn") outcomes.withdrawn++;
      else outcomes.noAnswer++;
      continue;
    }
    outcomes.interviews++;
    if (row.status === "offer") outcomes.offers++;
    else if (row.status === "rejected") outcomes.noOffer++;
    else if (row.status === "withdrawn") outcomes.withdrewAfterInterview++;
    else outcomes.interviewing++;
  }
  return outcomes;
}
