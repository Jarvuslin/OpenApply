import type { BankTargetQuestion } from "@openapply/contracts/answer-bank";
import type { Prisma } from "@/generated/prisma/client";
import { BANK_NORMALIZER_VERSION, bankEligibility, mapBankAnswer } from "./answer-bank.policy";
import { bankAvailability, bankRevisionInclude, bankView } from "./answer-bank.store";

/** Saved answers that map exactly onto this question, or null when the question is not bankable. */
export async function findBankMatches(
  tx: Prisma.TransactionClient,
  userId: string,
  target: BankTargetQuestion,
) {
  const eligibility = bankEligibility(target.definition, target.category, target, "employer");
  if (!eligibility.eligible || !eligibility.fingerprint) return null;
  const candidates = await tx.answerBankEntry.findMany({
    where: {
      userId,
      active: true,
      revisions: {
        some: {
          fingerprint: eligibility.fingerprint,
          normalizerVersion: BANK_NORMALIZER_VERSION,
          OR: [{ countryCode: null }, { countryCode: target.countryCode }],
          AND: [
            {
              OR: [
                { scope: "account" },
                { employerKey: eligibility.employerKey, roleKey: eligibility.roleKey },
              ],
            },
          ],
        },
      },
    },
    include: {
      revisions: { orderBy: { revision: "desc" }, take: 1, include: bankRevisionInclude },
    },
  });
  const matches = [];
  for (const entry of candidates) {
    const row = entry.revisions[0];
    if (!row || bankAvailability(row)) continue;
    const saved = bankView(row);
    const result = mapBankAnswer(
      {
        definition: saved.sourceDefinition,
        category: saved.category,
        values: saved.sourceValues,
        countryCode: saved.countryCode,
        employerKey: saved.employerKey,
        roleKey: saved.roleKey,
      },
      target,
    );
    if (!result.matched || !result.values) continue;
    matches.push({
      bankRevisionId: row.id,
      entryId: entry.id,
      revision: row.revision,
      mappedValues: result.values,
      scope: row.scope,
      countryCode: row.countryCode,
      employerKey: row.employerKey,
      roleKey: row.roleKey,
      sourceConfirmedAt: saved.sourceConfirmedAt,
      sourceQuestionId: saved.sourceQuestionId,
      sourceJobId: saved.sourceJobId,
      requiresConfirmation: true as const,
    });
  }
  return matches;
}
