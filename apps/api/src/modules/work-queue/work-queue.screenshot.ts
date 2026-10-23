import { workQueueChannel } from "@openapply/contracts/sse";
import { singleton } from "tsyringe";
import { badRequest, notFound } from "@/common/errors";
import { publish } from "@/common/sse";
import {
  saveSubmissionScreenshot,
  streamFile,
  submissionScreenshotPath,
} from "@/common/storage/storage";
import { PrismaClient } from "@/generated/prisma/client";
import { checkWorkLease } from "./work-queue.policy";

const MAX_BYTES = 8 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

@singleton()
export class WorkQueueScreenshotService {
  constructor(private readonly prisma: PrismaClient) {}

  /** The worker saves the employer's confirmation page while it still holds the lease. */
  async save(userId: string, id: string, leaseToken: string | undefined, file: File) {
    if (file.size > MAX_BYTES) throw badRequest("Screenshot is larger than 8 MB.");
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw badRequest("Screenshot must be a PNG.");
    const item = await this.prisma.workItem.findFirst({
      where: { id, userId, kind: "application" },
      select: { state: true, leaseToken: true, leaseExpiresAt: true },
    });
    if (!item) throw notFound("Owned application work not found.");
    checkWorkLease(item, leaseToken ?? "");
    await saveSubmissionScreenshot(id, bytes);
    publish(workQueueChannel, { userId }, { type: "work-queue.changed", itemId: id });
    return { ok: true as const };
  }

  async read(userId: string, id: string): Promise<Response> {
    const item = await this.prisma.workItem.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!item) throw notFound("Work item not found.");
    try {
      return await streamFile(submissionScreenshotPath(id), "image/png", "submission.png");
    } catch {
      throw notFound("This screenshot was cleared or never taken.");
    }
  }
}
