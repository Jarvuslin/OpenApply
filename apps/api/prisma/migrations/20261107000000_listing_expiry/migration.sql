ALTER TYPE "job_listing_status" ADD VALUE 'expired';

ALTER TABLE "job_listings" ADD COLUMN "expired_at" TIMESTAMP(3);

ALTER TABLE "job_listing_sources"
  ADD COLUMN "missed_refreshes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "gone_at" TIMESTAMP(3);
