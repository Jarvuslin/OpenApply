import { conflict } from "@/common/errors";
import type { Prisma } from "@/generated/prisma/client";

export async function assertNoLegacyAccount(
  tx: Prisma.TransactionClient,
  userId: string,
  tenantOrigin: string,
  email: string,
) {
  const hostname = new URL(tenantOrigin).hostname;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM employer_account_attempts
    WHERE user_id = ${userId}
      AND lower(btrim(email)) = ${email}
      AND lower(split_part(btrim(scope), '/', 1)) = ${hostname}
    LIMIT 1
  `;
  if (rows.length)
    throw conflict(
      "A preserved employer account attempt already exists. Review its migrated account setup; signup cannot be replayed.",
    );
}
