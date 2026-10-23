import type { Prisma } from "@/generated/prisma/client";

export function listingVisibility(userId?: string): Prisma.JobListingWhereInput {
  if (!userId) return { isPublic: true };
  return { OR: [{ isPublic: true }, { personalDiscoveries: { some: { userId } } }] };
}

export function sourceVisibility(userId?: string): Prisma.JobListingSourceWhereInput {
  if (!userId) return { isPublic: true };
  return {
    OR: [{ isPublic: true }, { listing: { personalDiscoveries: { some: { userId } } } }],
  };
}
