import { cursorPage } from "@jobpilot/contracts/pagination";
import type { CreatePilotJournalInput, PilotJournalKind } from "@jobpilot/contracts/pilot";
import { singleton } from "tsyringe";
import { publishActivity, toActivityEntry, writeActivity } from "@/common/activity-log";
import { PushService } from "@/common/push/push.service";
import { PrismaClient } from "@/generated/prisma/client";

const EXPORT_BATCH = 500;

@singleton()
export class PilotJournalService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly push: PushService,
  ) {}

  async appendJournal(userId: string, body: CreatePilotJournalInput) {
    const rows = await this.prisma.$transaction((tx) => writeActivity(tx, userId, body));
    const items = publishActivity(userId, rows);
    // The host journals orchestrator failures as system entries; push them so they reach the phone.
    for (const entry of items.filter((item) => item.kind === "system")) {
      void this.push.sendToUser(userId, {
        title: "Pilot alert",
        body: entry.summary,
        url: "/pilot",
        tag: "pilot-system",
      });
    }
    return { items };
  }

  async listJournal(
    userId: string,
    cursor: string | undefined,
    limit: number,
    kinds?: PilotJournalKind[],
  ) {
    const rows = await this.prisma.pilotJournalEntry.findMany({
      where: { userId, kind: kinds?.length ? { in: kinds } : undefined },
      // Batch appends share one createdAt, so id breaks the tie or cursor pages skip rows.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const { items, nextCursor } = cursorPage(rows, limit);
    return { items: items.map(toActivityEntry), nextCursor };
  }

  /** The whole journal as NDJSON, oldest first, read in batches so it is never all in memory. */
  streamJournalExport(userId: string): Response {
    const { prisma } = this;
    const encoder = new TextEncoder();
    let cursor: string | undefined;

    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const rows = await prisma.pilotJournalEntry.findMany({
          where: { userId },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: EXPORT_BATCH,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        if (rows.length === 0) {
          controller.close();
          return;
        }
        for (const row of rows) {
          controller.enqueue(encoder.encode(`${JSON.stringify(toActivityEntry(row))}\n`));
        }
        cursor = rows[rows.length - 1].id;
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "application/x-ndjson",
        "content-disposition": 'attachment; filename="pilot-journal.ndjson"',
      },
    });
  }
}
