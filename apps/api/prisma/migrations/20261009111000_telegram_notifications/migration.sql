CREATE TYPE "telegram_delivery_status" AS ENUM ('sent', 'unavailable', 'failed', 'unknown');

CREATE TABLE "telegram_settings" (
    "user_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "chat_id" TEXT NOT NULL,
    "bot_token" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "telegram_settings_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "telegram_deliveries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "status" "telegram_delivery_status" NOT NULL,
    "message_id" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "telegram_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "telegram_deliveries_user_id_question_id_key" ON "telegram_deliveries"("user_id", "question_id");
ALTER TABLE "telegram_settings" ADD CONSTRAINT "telegram_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_deliveries" ADD CONSTRAINT "telegram_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
