import { inject, singleton } from "tsyringe";
import { logger } from "@/common/logger";
import { TELEGRAM_CONFIG, type TelegramConfigHolder } from "./telegram.config";
import { TelegramInbound } from "./telegram.inbound";
import { TelegramScheduler } from "./telegram.scheduler";
import { pollOnce, webhookActive } from "./telegram.updates";

/**
 * Local development only (`TELEGRAM_UPDATES=polling`): fetches updates with getUpdates so no
 * public URL is needed. Run it in one API process per bot; Telegram answers 409 to a second one.
 */
@singleton()
export class TelegramPolling {
  private running = false;
  constructor(
    private readonly inbound: TelegramInbound,
    private readonly scheduler: TelegramScheduler,
    @inject(TELEGRAM_CONFIG) private readonly config: TelegramConfigHolder,
  ) {}
  start() {
    const telegram = this.config.telegram;
    if (this.running || telegram?.updates !== "polling") return;
    this.running = true;
    void this.run(telegram);
  }
  stop() {
    this.running = false;
  }
  private async run(telegram: NonNullable<TelegramConfigHolder["telegram"]>) {
    try {
      if (await webhookActive(telegram)) {
        logger.error(
          "Telegram polling is off: this bot has a webhook set, so it belongs to a deployed server. Use a separate bot for local development.",
        );
        this.running = false;
        return;
      }
    } catch {
      logger.warn("Could not check the Telegram webhook; polling anyway.");
    }
    logger.info("Telegram polling started.");
    let offset = 0;
    let lastProblem: string | null = null;
    while (this.running) {
      const result = await pollOnce(telegram, offset, (update) => this.inbound.accept(update));
      if (result.offset !== offset) await this.scheduler.tick();
      offset = result.offset;
      if (result.problem && result.problem !== lastProblem) {
        const detail = {
          conflict: "another process is polling this bot",
          rate_limited: "Telegram rate limit",
          unauthorized: "the bot token was rejected",
          network: "Telegram could not be reached",
          accept_failed: "an update could not be saved",
        }[result.problem];
        logger.warn(`Telegram polling paused: ${detail}.`);
      }
      lastProblem = result.problem;
      if (result.waitMs) await Bun.sleep(result.waitMs);
    }
  }
}
