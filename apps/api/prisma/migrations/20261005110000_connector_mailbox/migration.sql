ALTER TYPE "email_provider" ADD VALUE 'connector';
CREATE UNIQUE INDEX "email_messages_account_id_provider_id_key" ON "email_messages"("account_id", "provider_id");
DROP INDEX "email_messages_provider_id_key";
