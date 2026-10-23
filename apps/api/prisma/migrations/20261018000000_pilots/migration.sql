-- CreateEnum
CREATE TYPE "pilot_match_mode" AS ENUM ('review', 'queue');

-- CreateEnum
CREATE TYPE "pilot_run_trigger" AS ENUM ('manual', 'schedule');

-- CreateEnum
CREATE TYPE "pilot_run_state" AS ENUM ('scoring', 'done', 'stopped', 'failed');

-- CreateEnum
CREATE TYPE "pilot_result_status" AS ENUM ('scoring', 'review', 'added', 'removed', 'below_fit', 'unscored');

-- AlterEnum
ALTER TYPE "work_intent" ADD VALUE 'pilot_score';

-- CreateTable
CREATE TABLE "pilots" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "resume_id" TEXT NOT NULL,
    "min_score" INTEGER NOT NULL,
    "auto_run" BOOLEAN NOT NULL DEFAULT false,
    "interval_minutes" INTEGER NOT NULL DEFAULT 10,
    "mode" "pilot_match_mode" NOT NULL DEFAULT 'review',
    "max_jobs_per_run" INTEGER NOT NULL DEFAULT 15,
    "provider" "chat_provider" NOT NULL,
    "next_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pilots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pilot_runs" (
    "id" TEXT NOT NULL,
    "pilot_id" TEXT NOT NULL,
    "trigger" "pilot_run_trigger" NOT NULL,
    "state" "pilot_run_state" NOT NULL DEFAULT 'scoring',
    "scanned" INTEGER NOT NULL DEFAULT 0,
    "matched" INTEGER NOT NULL DEFAULT 0,
    "work_item_id" TEXT,
    "reason" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "pilot_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pilot_results" (
    "id" TEXT NOT NULL,
    "pilot_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "window_minutes" INTEGER,
    "posted_at" TIMESTAMP(3),
    "status" "pilot_result_status" NOT NULL DEFAULT 'scoring',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pilot_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pilots_campaign_id_key" ON "pilots"("campaign_id");

-- CreateIndex
CREATE INDEX "pilots_user_id_created_at_idx" ON "pilots"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "pilots_auto_run_next_run_at_idx" ON "pilots"("auto_run", "next_run_at");

-- CreateIndex
CREATE INDEX "pilot_runs_pilot_id_started_at_idx" ON "pilot_runs"("pilot_id", "started_at");

-- CreateIndex
CREATE INDEX "pilot_runs_state_idx" ON "pilot_runs"("state");

-- CreateIndex
CREATE UNIQUE INDEX "pilot_results_job_id_key" ON "pilot_results"("job_id");

-- CreateIndex
CREATE INDEX "pilot_results_pilot_id_status_idx" ON "pilot_results"("pilot_id", "status");

-- CreateIndex
CREATE INDEX "pilot_results_run_id_idx" ON "pilot_results"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "pilot_results_pilot_id_listing_id_key" ON "pilot_results"("pilot_id", "listing_id");

-- AddForeignKey
ALTER TABLE "pilots" ADD CONSTRAINT "pilots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pilots" ADD CONSTRAINT "pilots_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("campaign_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pilot_runs" ADD CONSTRAINT "pilot_runs_pilot_id_fkey" FOREIGN KEY ("pilot_id") REFERENCES "pilots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pilot_results" ADD CONSTRAINT "pilot_results_pilot_id_fkey" FOREIGN KEY ("pilot_id") REFERENCES "pilots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pilot_results" ADD CONSTRAINT "pilot_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "pilot_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pilot_results" ADD CONSTRAINT "pilot_results_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "job_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pilot_results" ADD CONSTRAINT "pilot_results_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

