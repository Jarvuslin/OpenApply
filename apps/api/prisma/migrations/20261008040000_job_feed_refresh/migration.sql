CREATE TABLE "job_feed_refreshes" (
    "key" TEXT NOT NULL,
    "next_refresh_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_token" TEXT,
    "lease_until" TIMESTAMP(3),
    "last_success_at" TIMESTAMP(3),
    "last_error" TEXT,
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "imported" INTEGER NOT NULL DEFAULT 0,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "job_feed_refreshes_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "job_feed_refreshes_next_refresh_at_idx" ON "job_feed_refreshes"("next_refresh_at");
