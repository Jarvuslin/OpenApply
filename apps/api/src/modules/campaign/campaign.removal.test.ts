import type { PrismaClient } from "@/generated/prisma/client";
import { CampaignService } from "./campaign.service";
import { describe, expect, it } from "bun:test";

describe("campaign deletion source fence", () => {
  it("waits for answer confirmation before ownership lookup and source deletion", async () => {
    const reached = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const actions: string[] = [];
    const db = {
      $queryRaw: async () => {
        reached.resolve();
        await release.promise;
        actions.push("locked");
      },
      campaign: {
        findFirst: async ({ where }: { where: unknown }) => {
          expect(where).toEqual({ campaignId: "owned", userId: "user" });
          actions.push("owned");
          return { campaignId: "owned" };
        },
        delete: async () => actions.push("campaign deleted"),
      },
      application: { deleteMany: async () => actions.push("applications deleted") },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(db),
    };
    const result = new CampaignService(db as unknown as PrismaClient).remove("user", "owned");
    await reached.promise;
    expect(actions).toEqual([]);
    release.resolve();
    expect(await result).toEqual({ deleted: true, campaignId: "owned" });
    expect(actions).toEqual(["locked", "owned", "applications deleted", "campaign deleted"]);
  });
});
