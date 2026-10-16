-- CreateEnum
CREATE TYPE "linkedin_discovery_run_status" AS ENUM ('claimed', 'processing', 'completed');

-- AlterTable
ALTER TABLE "job_listing_sources" ADD COLUMN     "is_public" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "job_listings" ADD COLUMN     "is_public" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "linkedin_discovery_settings" (
    "user_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "searches" JSONB NOT NULL DEFAULT '[]',
    "last_run_at" TIMESTAMP(3),
    "next_run_at" TIMESTAMP(3),
    "backoff_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "linkedin_discovery_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "linkedin_discovery_runs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "linkedin_discovery_run_status" NOT NULL DEFAULT 'claimed',
    "searches" JSONB NOT NULL,
    "lease_hash" TEXT NOT NULL,
    "lease_expires_at" TIMESTAMP(3) NOT NULL,
    "processing_until" TIMESTAMP(3),
    "payload_hash" TEXT,
    "result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "linkedin_discovery_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_job_listings" (
    "user_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "discovered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "personal_job_listings_pkey" PRIMARY KEY ("user_id","listing_id")
);

-- CreateIndex
CREATE INDEX "linkedin_discovery_runs_user_id_created_at_idx" ON "linkedin_discovery_runs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "personal_job_listings_listing_id_idx" ON "personal_job_listings"("listing_id");

-- AddForeignKey
ALTER TABLE "linkedin_discovery_settings" ADD CONSTRAINT "linkedin_discovery_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linkedin_discovery_runs" ADD CONSTRAINT "linkedin_discovery_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_job_listings" ADD CONSTRAINT "personal_job_listings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_job_listings" ADD CONSTRAINT "personal_job_listings_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "job_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
