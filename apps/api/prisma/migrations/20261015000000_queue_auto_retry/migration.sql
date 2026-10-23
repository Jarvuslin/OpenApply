-- AlterTable
ALTER TABLE "queue_policies" ADD COLUMN "auto_retry_failed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "work_items" ADD COLUMN "auto_retries" INTEGER NOT NULL DEFAULT 0;
