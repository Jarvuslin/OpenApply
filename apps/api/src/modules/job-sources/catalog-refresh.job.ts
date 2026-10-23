import { cron } from "@elysiajs/cron";
import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { logger } from "@/common/logger";
import { env } from "@/env";
import { CatalogRefreshService } from "./catalog-refresh.service";

const refresh = () => {
  if (!env.JOB_FEED_REFRESH_ENABLED || env.NODE_ENV === "test") return;
  void container
    .resolve(CatalogRefreshService)
    .refreshDue()
    .catch((err) => {
      logger.error({ err }, "Shared job feed refresh failed");
    });
};

export const catalogRefreshJob = new Elysia({ name: "job-feed-refresh" })
  .use(
    cron({
      name: "shared-job-feeds",
      pattern: "0 */5 * * * *",
      run: refresh,
    }),
  )
  .onStart(refresh);
