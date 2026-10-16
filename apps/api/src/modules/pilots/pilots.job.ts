import { cron } from "@elysiajs/cron";
import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { logger } from "@/common/logger";
import { env } from "@/env";
import { PilotsService } from "./pilots.service";

let ticking = false;

const tick = () => {
  if (env.NODE_ENV === "test" || ticking) return;
  ticking = true;
  void container
    .resolve(PilotsService)
    .tick()
    .catch((err: unknown) => logger.error({ err }, "Pilot scheduler tick failed"))
    .finally(() => {
      ticking = false;
    });
};

export const pilotsJob = new Elysia({ name: "pilots-scheduler" }).use(
  cron({ name: "pilots", pattern: "0 * * * * *", run: tick }),
);
