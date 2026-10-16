import { cron, Patterns } from "@elysiajs/cron";
import { SUBMISSION_SCREENSHOT_DAYS } from "@openapply/contracts/work-queue";
import { logger } from "@/common/logger";
import { pruneSubmissionScreenshots } from "@/common/storage/storage";

const DAY_MS = 24 * 60 * 60 * 1000;
const MB = 1024 * 1024;

/** Daily at 03:30 server time, so submission screenshots cannot pile up. */
export const screenshotsJob = cron({
  name: "prune-submission-screenshots",
  pattern: Patterns.everyDayAt("03:30"),
  run() {
    pruneSubmissionScreenshots({ ttlMs: SUBMISSION_SCREENSHOT_DAYS * DAY_MS, maxBytes: 256 * MB })
      .then((result) => {
        if (result.removed > 0) logger.info(result, "Pruned submission screenshots");
      })
      .catch((err) => logger.error({ err }, "Submission screenshot prune failed"));
  },
});
