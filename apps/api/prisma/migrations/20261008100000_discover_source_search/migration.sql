CREATE TABLE "job_source_searches" (
  "key" TEXT NOT NULL,
  "next_cursor" TEXT,
  "pages" INTEGER NOT NULL DEFAULT 0,
  "budget_started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_batch_at" TIMESTAMP(3),
  "last_result" JSONB,
  "exhausted" BOOLEAN NOT NULL DEFAULT false,
  "lease_token" TEXT,
  "lease_until" TIMESTAMP(3),
  CONSTRAINT "job_source_searches_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "job_source_searches_budget_started_at_idx" ON "job_source_searches"("budget_started_at");

UPDATE "job_feed_refreshes"
SET "next_refresh_at" = LEAST("next_refresh_at", "last_success_at" + INTERVAL '30 minutes')
WHERE "last_success_at" IS NOT NULL AND "last_error" IS NULL
  AND "key" NOT LIKE 'public/%';
