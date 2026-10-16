import { inject, singleton } from "tsyringe";
import { TELEGRAM_CONFIG, type TelegramConfigHolder } from "./telegram.config";
import { TelegramInbound } from "./telegram.inbound";
import { TelegramOutbox } from "./telegram.outbox";

@singleton()
export class TelegramScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private nextSchedule = 0;
  constructor(
    private readonly inbound: TelegramInbound,
    private readonly outbox: TelegramOutbox,
    @inject(TELEGRAM_CONFIG) private readonly config: TelegramConfigHolder,
  ) {}
  start() {
    if (this.timer || !this.config.telegram) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, 5000);
    this.timer.unref();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  async tick() {
    if (this.running || !this.config.telegram) return;
    this.running = true;
    try {
      for (let index = 0; index < 10 && (await this.inbound.processOne()); index++) {}
      if (Date.now() >= this.nextSchedule) {
        await this.outbox.schedule();
        this.nextSchedule = Date.now() + 60_000;
      }
      for (let index = 0; index < 10 && (await this.outbox.deliverOne()); index++) {}
    } catch {
      /* Durable processing and sending states make interruption recoverable without logging content. */
    } finally {
      this.running = false;
    }
  }
}
