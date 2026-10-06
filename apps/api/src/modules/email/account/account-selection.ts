import type { Prisma } from "@/generated/prisma/client";

export function getActiveEmailAccount(
  prisma: Pick<Prisma.TransactionClient, "emailAccount">,
  userId: string,
) {
  return prisma.emailAccount.findFirst({ where: { userId, activeForUser: { id: userId } } });
}

/** Call while holding the user's row lock, and only after creating a new mailbox. */
export async function selectFirstEmailAccount(
  prisma: Pick<Prisma.TransactionClient, "emailAccount" | "user">,
  userId: string,
  accountId: string,
) {
  const count = await prisma.emailAccount.count({ where: { userId } });
  if (count === 1) {
    await prisma.user.update({ where: { id: userId }, data: { activeEmailAccountId: accountId } });
  }
}
