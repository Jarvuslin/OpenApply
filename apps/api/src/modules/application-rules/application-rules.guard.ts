import { conflict } from "@/common/errors";
import type { Prisma } from "@/generated/prisma/client";
import { canonicalizeIntakeUrl } from "@/modules/application/job-url";
import { normalizeCompanyName } from "@/modules/scoring/applied-duplicates";

export async function companyExcluded(
  tx: Prisma.TransactionClient,
  userId: string,
  company: string,
) {
  const companyKey = normalizeCompanyName(company);
  if (!companyKey) return false;
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM application_rules WHERE user_id=${userId} AND company_key=${companyKey} AND active=true LIMIT 1`;
  return rows.length > 0;
}

export async function intakeDecisionPending(
  tx: Prisma.TransactionClient,
  userId: string,
  url: string,
) {
  const canonical = canonicalizeIntakeUrl(url);
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM job_intakes WHERE user_id=${userId} AND (canonical_url=${canonical} OR original_url=${canonical}) AND decision IN ('pending','skip') LIMIT 1`;
  return rows.length > 0;
}

export async function assertApplicationAllowed(
  tx: Prisma.TransactionClient,
  userId: string,
  job: { url: string; company: string; intakeDecisionRequired?: boolean },
) {
  if (job.intakeDecisionRequired || (await intakeDecisionPending(tx, userId, job.url)))
    throw conflict("Review this prepared link and choose Apply now or Add to queue first.");
  if (await companyExcluded(tx, userId, job.company))
    throw conflict("This company is excluded by your saved application rules.");
}
