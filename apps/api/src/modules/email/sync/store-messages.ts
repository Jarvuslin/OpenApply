import type { Prisma } from "@/generated/prisma/client";
import type { NormalizedMessage } from "../email.provider";

export async function storeMessages(
  db: Pick<Prisma.TransactionClient, "emailMessage">,
  accountId: string,
  messages: NormalizedMessage[],
) {
  if (messages.length === 0) return 0;
  const result = await db.emailMessage.createMany({
    data: messages.map((m) => ({
      accountId,
      providerId: m.providerId,
      threadId: m.threadId,
      subject: m.subject,
      fromAddress: m.fromAddress,
      toHeader: m.toHeader ?? null,
      fromName: m.fromName,
      fromDomain: m.fromDomain,
      snippet: m.snippet,
      rawBody: m.rawBody,
      receivedAt: m.receivedAt,
    })),
    skipDuplicates: true,
  });
  return result.count;
}
