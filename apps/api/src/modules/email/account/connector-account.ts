import type {
  IngestMessagesInput,
  RegisterConnectorAccountInput,
} from "@openapply/contracts/email";
import { conflict, findOwned } from "@/common/errors";
import type { Prisma } from "@/generated/prisma/client";
import { selectFirstEmailAccount } from "./account-selection";

type ConnectorAccountInput = RegisterConnectorAccountInput | Omit<IngestMessagesInput, "messages">;

/** The caller holds the user's row lock, including across registration and selection. */
export async function saveConnectorAccount(
  tx: Prisma.TransactionClient,
  userId: string,
  input: ConnectorAccountInput,
) {
  const email = input.mailbox.trim().toLowerCase();
  let account =
    "accountId" in input && input.accountId
      ? await findOwned(
          (where) => tx.emailAccount.findFirst({ where }),
          { id: input.accountId, userId },
          "Mailbox",
        )
      : await tx.emailAccount.findUnique({ where: { userId_email: { userId, email } } });
  if (account && account.email !== email) {
    throw conflict("The mailbox address does not match the requested mailbox account.");
  }
  if (account && account.provider !== "connector") {
    throw conflict(
      "This mailbox uses Google OAuth. Remove that connection before changing its connection method.",
    );
  }

  const checked = {
    lastCheckedAt: new Date(),
    refreshFailedAt: null,
    runtimeProvider: input.runtimeProvider,
    // An import alone cannot establish which authenticated identity the connector exposed.
    identityVerified: "identityVerified" in input ? input.identityVerified : undefined,
  };
  if (account) {
    return tx.emailAccount.update({ where: { id: account.id }, data: checked });
  }
  account = await tx.emailAccount.create({
    data: { userId, provider: "connector", email, ...checked },
  });
  await selectFirstEmailAccount(tx, userId, account.id);
  return account;
}
