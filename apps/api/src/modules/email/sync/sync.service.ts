import type { IngestMessagesInput } from "@jobpilot/contracts/email";
import { inboxChannel } from "@jobpilot/contracts/sse";
import { singleton } from "tsyringe";
import { CryptoService } from "@/common/crypto";
import { conflict, ErrorCodes, HttpError, notFound } from "@/common/errors";
import { logger } from "@/common/logger";
import { publish } from "@/common/sse";
import { PrismaClient } from "@/generated/prisma/client";
import { loadFreshAccount } from "../account/account.utils";
import { getProvider, rethrowGmailError } from "../gmail.provider";
import { storeMessages } from "./store-messages";

@singleton()
export class EmailSyncService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Best-effort pull for the pilot's agenda compile: skips when no account is connected or the
   * last sync is fresher than `staleMs`, and swallows failures - a broken mailbox must never
   * block the agenda.
   */
  async syncIfStale(userId: string, staleMs: number, now: Date): Promise<void> {
    const account = await this.prisma.emailAccount.findUnique({
      where: { userId },
      select: { lastSyncAt: true, provider: true },
    });

    if (!account || account.provider === "connector") {
      return;
    }

    const syncedRecently =
      account.lastSyncAt !== null && now.getTime() - account.lastSyncAt.getTime() < staleMs;

    if (syncedRecently) {
      return;
    }

    try {
      await this.syncInbox(userId);
    } catch (err) {
      logger.error({ err, userId }, "Pilot inbox sync failed");
    }
  }

  async ingest(userId: string, input: IngestMessagesInput) {
    const inserted = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      let account = await tx.emailAccount.findUnique({ where: { userId } });
      if (account && account.provider !== "connector")
        throw conflict("Disconnect the Google OAuth mailbox before using the agent connector.");
      if (account && account.email.toLowerCase() !== input.mailbox)
        throw conflict("Disconnect the current mailbox before switching connector accounts.");
      if (!account)
        account = await tx.emailAccount.create({
          data: { userId, provider: "connector", email: input.mailbox },
        });
      const count = await storeMessages(tx, account.id, input.messages);
      await tx.emailAccount.update({
        where: { id: account.id },
        data: { lastSyncAt: new Date(), refreshFailedAt: null },
      });
      return count;
    });
    const result = { fetched: input.messages.length, new: inserted };
    publish(inboxChannel, { userId }, { type: "sync.progress", ...result });
    return result;
  }

  async syncInbox(userId: string) {
    let loaded: Awaited<ReturnType<typeof loadFreshAccount>>;
    try {
      loaded = await loadFreshAccount(this.prisma, this.crypto, userId);
    } catch (e) {
      if (e instanceof HttpError && e.status === 409) throw e;
      throw new HttpError(
        ErrorCodes.UNPROCESSABLE,
        e instanceof Error ? e.message : "Token refresh failed",
        401,
      );
    }
    if (!loaded) {
      throw notFound("No email account connected");
    }

    const { account: active, config } = loaded;
    const provider = getProvider(active.provider);

    publish(inboxChannel, { userId }, { type: "sync.started" });

    const result = await provider.syncMessages(config, active).catch(rethrowGmailError);

    const inserted = await storeMessages(this.prisma, active.id, result.newMessages);

    await this.prisma.emailAccount.update({
      where: { id: active.id },
      data: {
        historyId: result.historyId ?? active.historyId,
        lastSyncAt: new Date(),
      },
    });

    publish(
      inboxChannel,
      { userId },
      {
        type: "sync.progress",
        fetched: result.fetched,
        new: inserted,
      },
    );

    return { fetched: result.fetched, new: inserted };
  }
}
