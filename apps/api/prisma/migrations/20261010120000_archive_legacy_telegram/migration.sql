-- Preserve the original notification evidence without asserting a new channel pairing.
ALTER TABLE "telegram_settings" RENAME TO "legacy_telegram_settings";
ALTER TABLE "legacy_telegram_settings" RENAME CONSTRAINT "telegram_settings_pkey" TO "legacy_telegram_settings_pkey";
ALTER TABLE "legacy_telegram_settings" RENAME CONSTRAINT "telegram_settings_user_id_fkey" TO "legacy_telegram_settings_user_id_fkey";

ALTER TABLE "telegram_deliveries" RENAME TO "legacy_telegram_deliveries";
ALTER TABLE "legacy_telegram_deliveries" RENAME CONSTRAINT "telegram_deliveries_pkey" TO "legacy_telegram_deliveries_pkey";
ALTER TABLE "legacy_telegram_deliveries" RENAME CONSTRAINT "telegram_deliveries_user_id_fkey" TO "legacy_telegram_deliveries_user_id_fkey";
ALTER INDEX "telegram_deliveries_user_id_question_id_key" RENAME TO "legacy_telegram_deliveries_user_id_question_id_key";
