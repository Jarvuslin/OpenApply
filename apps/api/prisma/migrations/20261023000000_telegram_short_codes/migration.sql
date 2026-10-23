-- Pairing moves to 6-character codes hashed with a separate key. Pending long codes can never
-- match again, so they are cancelled rather than left to expire.
UPDATE "telegram_pairings" SET "cancelled_at" = CURRENT_TIMESTAMP
WHERE "consumed_at" IS NULL AND "cancelled_at" IS NULL;

-- CreateEnum
CREATE TYPE "telegram_sender_event_kind" AS ENUM ('failed_code', 'reply');

-- AlterTable
ALTER TABLE "telegram_links" ADD COLUMN "username" TEXT;

-- CreateTable
CREATE TABLE "telegram_sender_events" (
    "id" TEXT NOT NULL,
    "sender_hash" TEXT NOT NULL,
    "kind" "telegram_sender_event_kind" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_sender_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "telegram_sender_events_sender_hash_kind_created_at_idx" ON "telegram_sender_events"("sender_hash", "kind", "created_at");

-- CreateIndex
CREATE INDEX "telegram_sender_events_kind_created_at_idx" ON "telegram_sender_events"("kind", "created_at");
