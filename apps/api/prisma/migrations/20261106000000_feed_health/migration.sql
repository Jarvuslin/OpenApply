CREATE TYPE "feed_alert" AS ENUM ('failing', 'dropped', 'empty');

ALTER TABLE "job_feed_refreshes"
  ADD COLUMN "failures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "previous_fetched" INTEGER,
  ADD COLUMN "alert" "feed_alert",
  ADD COLUMN "alerted_at" TIMESTAMP(3);
