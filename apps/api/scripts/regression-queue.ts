import { container } from "../src/common/di/container";
import type { PrismaClient } from "../src/generated/prisma/client";
import { ResumeArtifactService } from "../src/modules/resume/resume-artifact.service";
import { ScoringService } from "../src/modules/scoring/scoring.service";
import { WorkQueueClaimService } from "../src/modules/work-queue/work-queue.claim";
import { WorkQueueService } from "../src/modules/work-queue/work-queue.service";

// Old deterministic fixture suites choose their synthetic rows explicitly. The product API
// has no FIFO/no-body claim path and this adapter never starts a provider or browser.
export function regressionQueue(db: PrismaClient) {
  const queue = new WorkQueueService(db);
  const claims = new WorkQueueClaimService(
    db,
    queue,
    container.resolve(ResumeArtifactService),
    container.resolve(ScoringService),
  );
  const runtimeId = crypto.randomUUID();
  const workerId = crypto.randomUUID();
  return Object.assign(queue, {
    claim: async (userId: string) => {
      await queue.refresh(userId);
      const items = await db.workItem.findMany({
        where: { userId, state: "queued" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      for (const item of items) {
        const result = await claims.claim(userId, {
          requestId: crypto.randomUUID(),
          runtimeId,
          workerId,
          workItemId: item.id,
          capabilities: { isolatedBrowser: true },
        });
        if (result.claim) return result.claim;
      }
      return null;
    },
  });
}
