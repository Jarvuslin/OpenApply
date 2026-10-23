import { db } from "@/common/database/prisma.client";
import { emailNotVerified } from "@/common/errors";

export async function requireVerifiedEmail(userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { emailVerified: true },
  });
  if (!user?.emailVerified) {
    throw emailNotVerified();
  }
}
